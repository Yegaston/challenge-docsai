resource "aws_db_subnet_group" "main" {
  name       = "${var.name}-database"
  subnet_ids = [for s in aws_subnet.database : s.id]
}
resource "aws_db_instance" "postgres" {
  identifier                  = "${var.name}-postgres"
  engine                      = "postgres"
  engine_version              = "16"
  instance_class              = "db.t3.micro"
  allocated_storage           = 20
  storage_type                = "gp3"
  storage_encrypted           = true
  db_name                     = "challenge"
  username                    = "challenge_admin"
  manage_master_user_password = var.local_emulation ? null : true
  password                    = var.local_emulation ? "LOCAL-DUMMY-not-for-AWS-42" : null
  db_subnet_group_name        = aws_db_subnet_group.main.name
  vpc_security_group_ids      = [aws_security_group.database.id]
  publicly_accessible         = false
  multi_az                    = false
  backup_retention_period     = 1
  deletion_protection         = var.protect_database
  skip_final_snapshot         = !var.protect_database
  final_snapshot_identifier   = var.protect_database ? "${var.name}-final" : null
  copy_tags_to_snapshot       = true
}
# Containers only: populate outside Terraform; never read versions into state.
resource "aws_secretsmanager_secret" "application" {
  for_each                = toset(["DATABASE_URL", "DEMO_EMAIL", "DEMO_PASSWORD", "JWT_SECRET", "SUPPORT_EMAIL", "SUPPORT_PASSWORD", "OPENROUTER_API_KEY"])
  name                    = "${var.name}/${each.key}"
  recovery_window_in_days = 7
}
