locals {
  azs = { a = 0, b = 1 }
}
resource "aws_vpc" "main" {
  cidr_block           = "10.42.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true
}
resource "aws_subnet" "public" {
  for_each                = local.azs
  vpc_id                  = aws_vpc.main.id
  availability_zone       = "${var.region}${each.key}"
  cidr_block              = cidrsubnet(aws_vpc.main.cidr_block, 8, each.value)
  map_public_ip_on_launch = false
}
resource "aws_subnet" "application" {
  for_each                = local.azs
  vpc_id                  = aws_vpc.main.id
  availability_zone       = "${var.region}${each.key}"
  cidr_block              = cidrsubnet(aws_vpc.main.cidr_block, 8, each.value + 10)
  map_public_ip_on_launch = false
}
resource "aws_subnet" "database" {
  for_each                = local.azs
  vpc_id                  = aws_vpc.main.id
  availability_zone       = "${var.region}${each.key}"
  cidr_block              = cidrsubnet(aws_vpc.main.cidr_block, 8, each.value + 20)
  map_public_ip_on_launch = false
}
resource "aws_internet_gateway" "main" { vpc_id = aws_vpc.main.id }
resource "aws_eip" "nat" { domain = "vpc" }
resource "aws_nat_gateway" "main" {
  allocation_id = aws_eip.nat.id
  subnet_id     = aws_subnet.public["a"].id
  depends_on    = [aws_internet_gateway.main]
}
resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }
}
resource "aws_route_table" "application" {
  vpc_id = aws_vpc.main.id
  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.main.id
  }
}
resource "aws_route_table" "database" { vpc_id = aws_vpc.main.id }
resource "aws_route_table_association" "public" {
  for_each       = aws_subnet.public
  subnet_id      = each.value.id
  route_table_id = aws_route_table.public.id
}
resource "aws_route_table_association" "application" {
  for_each       = aws_subnet.application
  subnet_id      = each.value.id
  route_table_id = aws_route_table.application.id
}
resource "aws_route_table_association" "database" {
  for_each       = aws_subnet.database
  subnet_id      = each.value.id
  route_table_id = aws_route_table.database.id
}
