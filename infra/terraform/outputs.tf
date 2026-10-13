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
