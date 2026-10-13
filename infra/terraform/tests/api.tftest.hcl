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

run "fargate_architecture" {
  command = apply
  assert {
    condition     = aws_ecs_service.api.launch_type == "FARGATE" && alltrue([for c in aws_ecs_task_definition.api.requires_compatibilities : c == "FARGATE"]) && aws_ecs_task_definition.api.network_mode == "awsvpc"
    error_message = "API must run on Fargate with awsvpc networking."
  }
  assert {
    condition     = aws_ecs_task_definition.api.cpu == "256" && aws_ecs_task_definition.api.memory == "512" && aws_ecs_task_definition.api.runtime_platform[0].cpu_architecture == "X86_64" && aws_ecs_task_definition.api.runtime_platform[0].operating_system_family == "LINUX"
    error_message = "Valid Fargate CPU/memory pair on x86_64 Linux."
  }
  assert {
    condition     = aws_ecs_service.api.desired_count == 0 && !aws_ecs_service.api.network_configuration[0].assign_public_ip && length(aws_ecs_service.api.network_configuration[0].subnets) == length(aws_subnet.application)
    error_message = "Bootstrap starts at zero tasks in private subnets without public IP."
  }
  assert {
    condition     = jsondecode(aws_ecs_task_definition.api.container_definitions)[0].portMappings[0].containerPort == 3001 && jsondecode(aws_ecs_task_definition.api.container_definitions)[0].healthCheck.command[1] != ""
    error_message = "Container serves port 3001 with a real API-route health check."
  }
}

run "iam_and_secret_references" {
  command = apply
  assert {
    condition     = [for s in jsondecode(aws_ecs_task_definition.api.container_definitions)[0].secrets : s.valueFrom if s.name == "DATABASE_URL"][0] == aws_secretsmanager_secret.application["DATABASE_URL"].arn && length(jsondecode(aws_ecs_task_definition.api.container_definitions)[0].secrets) == 7
    error_message = "All seven secret containers reference Secrets Manager ARNs; DATABASE_URL is populated out of band."
  }
  assert {
    condition     = length([for e in jsondecode(aws_ecs_task_definition.api.container_definitions)[0].environment : e.name if contains(["DATABASE_URL", "DEMO_EMAIL", "DEMO_PASSWORD", "JWT_SECRET", "SUPPORT_EMAIL", "SUPPORT_PASSWORD", "OPENROUTER_API_KEY"], e.name)]) == 0
    error_message = "Environment carries only non-secret values."
  }
  assert {
    condition     = aws_iam_role_policy_attachment.execution.policy_arn == "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy" && jsondecode(aws_iam_role_policy.execution_secrets.policy).Statement[0].Resource == [for k, s in aws_secretsmanager_secret.application : s.arn]
    error_message = "Execution role: managed ECR/log policy plus secrets read scoped to the application ARNs."
  }
  assert {
    condition     = aws_iam_role.execution.name != aws_iam_role.task.name && aws_ecs_task_definition.api.execution_role_arn == aws_iam_role.execution.arn && aws_ecs_task_definition.api.task_role_arn == aws_iam_role.task.arn
    error_message = "Execution and task roles must be separate."
  }
}

run "alb_targets_and_bootstrap" {
  command = apply
  assert {
    condition     = aws_lb.api.subnets == toset([for s in aws_subnet.public : s.id]) && aws_lb_target_group.api.target_type == "ip" && aws_lb_target_group.api.port == 3001 && aws_lb_target_group.api.health_check[0].path == "/api/health" && aws_lb_target_group.api.health_check[0].matcher == "200"
    error_message = "ALB on public subnets forwards IP targets to API port 3001 via the real health route."
  }
  assert {
    condition     = aws_lb_listener.api_local_http[0].port == 80 && aws_lb_listener.api_local_http[0].protocol == "HTTP"
    error_message = "Local emulation serves plain HTTP; AWS mode requires TLS."
  }
  assert {
    condition     = aws_ecr_repository.api.image_tag_mutability == "IMMUTABLE" && aws_ecr_repository.api.image_scanning_configuration[0].scan_on_push && aws_cloudwatch_log_group.api.name == "/ecs/${var.name}/api"
    error_message = "ECR immutable/scanned; task logs go to a dedicated group."
  }
}

run "reject_insecure_aws_deployment" {
  command = plan
  variables {
    local_emulation = false
    allow_aws       = true
    aws_account_id  = "123456789012"
  }
  expect_failures = [var.api_certificate_arn, var.api_image, var.api_hostname]
}

run "reject_invalid_aws_image" {
  command = plan
  variables {
    local_emulation     = false
    allow_aws           = true
    aws_account_id      = "123456789012"
    api_certificate_arn = "arn:aws:acm:us-east-1:123456789012:certificate/mock"
    api_hostname        = "api.example.com"
    api_image           = "floci-challenge-api:latest"
  }
  expect_failures = [var.api_image]
}

run "external_origin_env" {
  command = apply
  assert {
    condition     = [for e in jsondecode(aws_ecs_task_definition.api.container_definitions)[0].environment : e.value if e.name == "AUTH_EXTERNAL_ORIGIN"][0] == "https://${aws_cloudfront_distribution.frontend.domain_name}"
    error_message = "AUTH_EXTERNAL_ORIGIN is a nonsecret derived from the CloudFront domain, never a secret or SPA value."
  }
}

run "aws_tls_and_ecr_image" {
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
    condition     = aws_lb_listener.api[0].port == 443 && aws_lb_listener.api[0].protocol == "HTTPS" && aws_lb_listener.api[0].certificate_arn == var.api_certificate_arn && aws_lb_listener.api[0].ssl_policy != null
    error_message = "AWS mode must terminate TLS with the provided certificate."
  }
  assert {
    condition     = var.api_image == "123456789012.dkr.ecr.us-east-1.amazonaws.com/challenge-api"
    error_message = "AWS mode requires an ECR image URI."
  }
}
