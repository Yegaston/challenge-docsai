output "network" {
  description = "Subnet IDs and SG IDs for future ALB and private ECS tasks."
  value = {
    vpc_id                 = aws_vpc.main.id
    public_subnet_ids      = [for s in aws_subnet.public : s.id]
    application_subnet_ids = [for s in aws_subnet.application : s.id]
    security_group_ids     = { alb = aws_security_group.alb.id, api = aws_security_group.api.id, database = aws_security_group.database.id }
  }
}
output "database" {
  description = "Connection metadata only; AWS managed master secret ARN is not a DATABASE_URL."
  value = {
    address           = aws_db_instance.postgres.address
    port              = aws_db_instance.postgres.port
    name              = aws_db_instance.postgres.db_name
    username          = aws_db_instance.postgres.username
    master_secret_arn = var.local_emulation ? null : aws_db_instance.postgres.master_user_secret[0].secret_arn
  }
}
output "application_secret_arns" {
  description = "Whole-value ECS valueFrom references; versions must be populated separately."
  value       = { for k, s in aws_secretsmanager_secret.application : k => s.arn }
}
output "api" {
  description = "ALB origin for the frontend unit; cloudfront_restriction_pending is true until T2c restricts ALB ingress to CloudFront prefixes and cookie/header forwarding is verified."
  value = {
    repository_url                       = aws_ecr_repository.api.repository_url
    cluster_name                         = aws_ecs_cluster.api.name
    service_name                         = aws_ecs_service.api.name
    alb_dns_name                         = aws_lb.api.dns_name
    listener_port                        = var.local_emulation ? 80 : 443
    listener_protocol                    = var.local_emulation ? "HTTP" : "HTTPS"
    health_check_path                    = aws_lb_target_group.api.health_check[0].path
    alb_ingress_restricted_to_cloudfront = !var.local_emulation
  }
}
output "frontend" {
  description = "SPA bucket and CloudFront endpoints for the Floci workflow; Terraform manages no bucket objects."
  value = {
    bucket_name         = aws_s3_bucket.frontend.bucket
    distribution_id     = aws_cloudfront_distribution.frontend.id
    distribution_domain = aws_cloudfront_distribution.frontend.domain_name
    external_origin     = local.external_origin
    api_behaviors       = [for b in aws_cloudfront_distribution.frontend.ordered_cache_behavior : b.path_pattern]
  }
}
