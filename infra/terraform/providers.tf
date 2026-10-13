terraform {
  required_version = "= 1.9.8"
  required_providers {
    aws = { source = "hashicorp/aws", version = "= 5.82.2" }
  }
}
provider "aws" {
  region                      = var.region
  access_key                  = var.local_emulation ? "local-dummy" : null
  secret_key                  = var.local_emulation ? "local-dummy" : null
  skip_credentials_validation = var.local_emulation
  skip_metadata_api_check     = var.local_emulation
  skip_requesting_account_id  = var.local_emulation
  allowed_account_ids         = var.local_emulation ? null : [var.aws_account_id]
  dynamic "endpoints" {
    for_each = var.local_emulation ? [var.local_endpoint] : []
    content {
      ec2            = endpoints.value
      ecr            = endpoints.value
      ecs            = endpoints.value
      elbv2          = endpoints.value
      iam            = endpoints.value
      logs           = endpoints.value
      rds            = endpoints.value
      secretsmanager = endpoints.value
      sts            = endpoints.value
    }
  }
  default_tags { tags = { Project = var.name, Environment = "challenge" } }
}
