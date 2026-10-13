resource "aws_security_group" "alb" {
  name_prefix = "${var.name}-alb-"
  vpc_id      = aws_vpc.main.id
}
resource "aws_security_group" "api" {
  name_prefix = "${var.name}-api-"
  vpc_id      = aws_vpc.main.id
}
resource "aws_security_group" "database" {
  name_prefix = "${var.name}-database-"
  vpc_id      = aws_vpc.main.id
}
resource "aws_vpc_security_group_ingress_rule" "api" {
  security_group_id            = aws_security_group.api.id
  referenced_security_group_id = aws_security_group.alb.id
  ip_protocol                  = "tcp"
  from_port                    = 3001
  to_port                      = 3001
}
resource "aws_vpc_security_group_egress_rule" "alb_api" {
  security_group_id            = aws_security_group.alb.id
  referenced_security_group_id = aws_security_group.api.id
  ip_protocol                  = "tcp"
  from_port                    = 3001
  to_port                      = 3001
}
resource "aws_vpc_security_group_ingress_rule" "database" {
  security_group_id            = aws_security_group.database.id
  referenced_security_group_id = aws_security_group.api.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
}
resource "aws_vpc_security_group_egress_rule" "api_database" {
  security_group_id            = aws_security_group.api.id
  referenced_security_group_id = aws_security_group.database.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
}
resource "aws_vpc_security_group_egress_rule" "api_https" {
  security_group_id = aws_security_group.api.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}
# Local emulation only: the Floci ALB listener stays plain HTTP and isolated
# from the AWS-mode TLS rule below; local Floci restriction semantics differ.
resource "aws_vpc_security_group_ingress_rule" "alb_local_http" {
  count             = var.local_emulation ? 1 : 0
  security_group_id = aws_security_group.alb.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
}

# AWS mode: ALB ingress only from the CloudFront origin-facing managed prefix
# list, never 0.0.0.0/0. The prefix list is shared across CloudFront tenants;
# the shared-CDN-tenant limitation is documented in docs/deployment.md.
data "aws_ec2_managed_prefix_list" "cloudfront_origin" {
  count = var.local_emulation ? 0 : 1
  filter {
    name   = "prefix-list-name"
    values = ["com.amazonaws.global.cloudfront.origin-facing"]
  }
}
resource "aws_vpc_security_group_ingress_rule" "alb_aws_https" {
  count             = var.local_emulation ? 0 : 1
  security_group_id = aws_security_group.alb.id
  prefix_list_id    = var.local_emulation ? null : try(data.aws_ec2_managed_prefix_list.cloudfront_origin[0].id, null)
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}
