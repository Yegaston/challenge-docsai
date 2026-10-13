# Local-only Terraform overrides for the Floci 2.2.0 emulation. The guarded
# wrapper (scripts/floci-deploy.sh) copies this file into the isolated,
# gitignored working copy infra/floci/work/ and runs Terraform only there;
# Terraform merge rules apply it on top of the copied AWS root configuration.
# It is never written into the shared AWS root (infra/terraform), so real AWS
# mode stays fully drift-aware. Terraform lifecycle cannot be dynamic, hence
# this file-based isolation.
#
# Floci 2.2.0 drift that would otherwise fail every later local apply:
# - The ECR repository is created with the requested KMS configuration but
#   always reports AES256 back, so every refresh looks like a change that
#   forces replacement (which fails while the repository holds images).
# - CloudFront function code is returned base64-encoded while the AWS provider
#   compares plain text, so every refresh looks like a code change and Floci's
#   PublishFunction then rejects the update (InvalidIfMatchVersion).
#
# On AWS, changing either attribute requires an explicit
# `terraform apply -replace=...`; residual security-group drift in emulation
# remains documented as harmless in-place updates.

resource "aws_ecr_repository" "api" {
  lifecycle {
    ignore_changes = [encryption_configuration]
  }
}

resource "aws_cloudfront_function" "spa_rewrite" {
  lifecycle {
    ignore_changes = [code]
  }
}
