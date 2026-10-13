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

run "reject_remote_endpoint" {
  command = plan
  variables { local_endpoint = "https://ec2.us-east-1.amazonaws.com" }
  expect_failures = [var.local_endpoint]
}
run "reject_unacknowledged_aws" {
  command = plan
  variables {
    local_emulation     = false
    api_image           = "123456789012.dkr.ecr.us-east-1.amazonaws.com/challenge-api"
    api_certificate_arn = "arn:aws:acm:us-east-1:123456789012:certificate/mock"
  }
  expect_failures = [var.allow_aws, var.api_hostname]
}

run "foundation" {
  command = apply
  assert {
    condition     = length(aws_subnet.public) == 2 && length(aws_subnet.application) == 2 && length(aws_subnet.database) == 2
    error_message = "Use two AZs and separate public/application/database tiers."
  }
  assert {
    condition     = alltrue([for s in aws_subnet.application : !s.map_public_ip_on_launch]) && !aws_db_instance.postgres.publicly_accessible
    error_message = "Applications and database must be private."
  }
  assert {
    condition     = aws_db_instance.postgres.storage_encrypted && aws_db_instance.postgres.backup_retention_period == 1
    error_message = "Encrypt DB and retain demo backups."
  }
  assert {
    condition     = aws_vpc_security_group_ingress_rule.api.referenced_security_group_id == aws_security_group.alb.id && aws_vpc_security_group_ingress_rule.api.from_port == 3001 && aws_vpc_security_group_ingress_rule.database.referenced_security_group_id == aws_security_group.api.id && aws_vpc_security_group_ingress_rule.database.from_port == 5432
    error_message = "Only ALB -> API:3001 -> DB:5432 ingress."
  }
  assert {
    condition     = length(aws_secretsmanager_secret.application) == 7 && aws_db_instance.postgres.password == "LOCAL-DUMMY-not-for-AWS-42"
    error_message = "Local bootstrap is separate from application secret containers."
  }
}

run "aws_credentials" {
  command = apply
  variables {
    local_emulation     = false
    aws_account_id      = "123456789012"
    allow_aws           = true
    api_image           = "123456789012.dkr.ecr.us-east-1.amazonaws.com/challenge-api"
    api_certificate_arn = "arn:aws:acm:us-east-1:123456789012:certificate/mock"
    api_hostname        = "api.example.com"
  }
  assert {
    condition     = aws_db_instance.postgres.manage_master_user_password && aws_db_instance.postgres.password == null
    error_message = "AWS must use RDS-managed credentials, never local password."
  }
}
