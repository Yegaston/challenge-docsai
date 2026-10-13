mock_provider "aws" {
  mock_resource "aws_iam_role" { defaults = { arn = "arn:aws:iam::123456789012:role/mock" } }
  mock_resource "aws_lb" { defaults = { arn = "arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/app/mock/abc" } }
  mock_resource "aws_lb_target_group" { defaults = { arn = "arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/mock/abc" } }
  mock_resource "aws_ecs_task_definition" { defaults = { arn = "arn:aws:ecs:us-east-1:123456789012:task-definition/mock:1" } }
  mock_resource "aws_db_instance" {
    defaults = { master_user_secret = [{ secret_arn = "arn:aws:secretsmanager:us-east-1:123456789012:secret:mock", secret_status = "active", kms_key_id = "mock" }] }
  }
  mock_resource "aws_cloudfront_function" { defaults = { arn = "arn:aws:cloudfront::123456789012:function/mock" } }
  mock_data "aws_ec2_managed_prefix_list" { defaults = { id = "pl-cloudfront-origin", name = "com.amazonaws.global.cloudfront.origin-facing" } }
}

run "spa_bucket_private_and_oac" {
  command = apply
  assert {
    condition     = aws_s3_bucket_public_access_block.frontend.block_public_acls && aws_s3_bucket_public_access_block.frontend.block_public_policy && aws_s3_bucket_public_access_block.frontend.ignore_public_acls && aws_s3_bucket_public_access_block.frontend.restrict_public_buckets
    error_message = "Frontend SPA bucket must block every public access path."
  }
  assert {
    condition     = alltrue([for r in aws_s3_bucket_server_side_encryption_configuration.frontend.rule : contains([for e in r.apply_server_side_encryption_by_default : e.sse_algorithm], "AES256")])
    error_message = "Frontend SPA bucket must be encrypted at rest."
  }
  assert {
    condition     = aws_cloudfront_origin_access_control.spa.signing_behavior == "always" && aws_cloudfront_origin_access_control.spa.signing_protocol == "sigv4" && aws_cloudfront_origin_access_control.spa.origin_access_control_origin_type == "s3"
    error_message = "S3 origin must be reached through CloudFront OAC signed access, not a public endpoint."
  }
  assert {
    condition     = jsondecode(aws_s3_bucket_policy.frontend.policy).Statement[0].Principal.Service == "cloudfront.amazonaws.com" && jsondecode(aws_s3_bucket_policy.frontend.policy).Statement[0].Condition.StringEquals["AWS:SourceArn"] == aws_cloudfront_distribution.frontend.arn
    error_message = "Bucket policy must grant only this distribution's ARN via OAC."
  }
}

run "api_behavior_no_cache_and_forwarding" {
  command = apply
  assert {
    condition     = length(aws_cloudfront_distribution.frontend.ordered_cache_behavior) == 2 && alltrue([for b in aws_cloudfront_distribution.frontend.ordered_cache_behavior : b.target_origin_id == "api" && contains(["/api", "/api/*"], b.path_pattern)])
    error_message = "Both exact /api and /api/* behaviors must target the ALB origin."
  }
  assert {
    condition     = alltrue([for b in aws_cloudfront_distribution.frontend.ordered_cache_behavior : contains(b.allowed_methods, "POST") && contains(b.allowed_methods, "PUT") && contains(b.allowed_methods, "PATCH") && contains(b.allowed_methods, "DELETE") && contains(b.allowed_methods, "GET") && contains(b.allowed_methods, "HEAD") && contains(b.allowed_methods, "OPTIONS") && b.viewer_protocol_policy == "https-only"])
    error_message = "API behavior must forward all HTTP methods over HTTPS to the origin."
  }
  assert {
    condition     = aws_cloudfront_cache_policy.api_no_cache.min_ttl == 0 && aws_cloudfront_cache_policy.api_no_cache.default_ttl == 0 && aws_cloudfront_cache_policy.api_no_cache.max_ttl == 0
    error_message = "No managed-policy dependence: API caching must be explicitly disabled with a zero-TTL policy."
  }
  assert {
    condition     = aws_cloudfront_cache_policy.api_no_cache.parameters_in_cache_key_and_forwarded_to_origin[0].cookies_config[0].cookie_behavior == "all" && aws_cloudfront_cache_policy.api_no_cache.parameters_in_cache_key_and_forwarded_to_origin[0].query_strings_config[0].query_string_behavior == "all" && contains(aws_cloudfront_cache_policy.api_no_cache.parameters_in_cache_key_and_forwarded_to_origin[0].headers_config[0].headers[0].items, "Authorization") && contains(aws_cloudfront_cache_policy.api_no_cache.parameters_in_cache_key_and_forwarded_to_origin[0].headers_config[0].headers[0].items, "Content-Type")
    error_message = "API behavior must forward cookies, query strings and Authorization/Content-Type headers."
  }
}

run "spa_rewrite_scope" {
  command = apply
  assert {
    condition     = aws_cloudfront_distribution.frontend.default_cache_behavior[0].target_origin_id == "spa" && aws_cloudfront_distribution.frontend.default_cache_behavior[0].viewer_protocol_policy == "redirect-to-https"
    error_message = "Default behavior serves the private S3 SPA and upgrades HTTP viewers."
  }
  assert {
    condition     = length(aws_cloudfront_distribution.frontend.default_cache_behavior[0].function_association) == 1 && alltrue([for f in aws_cloudfront_distribution.frontend.default_cache_behavior[0].function_association : f.function_arn == aws_cloudfront_function.spa_rewrite.arn])
    error_message = "The SPA viewer rewrite must be attached to the S3 default behavior."
  }
  assert {
    condition     = alltrue([for b in aws_cloudfront_distribution.frontend.ordered_cache_behavior : length(b.function_association) == 0])
    error_message = "The SPA rewrite must never apply to API behaviors."
  }
  assert {
    condition     = length(aws_cloudfront_distribution.frontend.custom_error_response) == 0
    error_message = "No distribution-wide 403/404-to-200 masking of API errors."
  }
}

run "aws_origin_tls_and_prefix_restriction" {
  command = apply
  variables {
    local_emulation     = false
    allow_aws           = true
    aws_account_id      = "123456789012"
    api_image           = "123456789012.dkr.ecr.us-east-1.amazonaws.com/challenge-api"
    api_certificate_arn = "arn:aws:acm:us-east-1:123456789012:certificate/mock"
    api_hostname        = "api.example.com"
  }
  assert {
    condition     = [for o in aws_cloudfront_distribution.frontend.origin : o.custom_origin_config[0].origin_protocol_policy if o.origin_id == "api"][0] == "https-only" && [for o in aws_cloudfront_distribution.frontend.origin : o.domain_name if o.origin_id == "api"][0] == var.api_hostname
    error_message = "AWS API origin must be HTTPS to the certificate-matching hostname, never the autogenerated ALB DNS."
  }
  assert {
    condition     = aws_vpc_security_group_ingress_rule.alb_aws_https[0].prefix_list_id == "pl-cloudfront-origin" && aws_vpc_security_group_ingress_rule.alb_aws_https[0].cidr_ipv4 == null && aws_vpc_security_group_ingress_rule.alb_aws_https[0].from_port == 443
    error_message = "AWS ALB ingress must be restricted to the CloudFront origin-facing managed prefix list."
  }
  assert {
    condition     = length(aws_vpc_security_group_ingress_rule.alb_local_http) == 0
    error_message = "Local-only plain HTTP listener must be isolated to emulation."
  }
}
