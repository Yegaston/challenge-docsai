variable "local_emulation" {
  type        = bool
  default     = true
  description = "Use dummy credentials and only the allowlisted emulator endpoint."
}
variable "local_endpoint" {
  type        = string
  default     = "http://floci:4566"
  description = "Docker Floci or loopback endpoint; never an AWS URL."
  validation {
    condition     = can(regex("^http://(floci|localhost|127\\.0\\.0\\.1|host\\.docker\\.internal):[0-9]+$", var.local_endpoint))
    error_message = "Only explicit local HTTP emulator hosts are allowed."
  }
}
variable "allow_aws" {
  type        = bool
  default     = false
  description = "Explicit real-AWS acknowledgement; not approved for this challenge."
  validation {
    condition     = var.local_emulation || (var.allow_aws && can(regex("^[0-9]{12}$", var.aws_account_id)))
    error_message = "AWS mode requires explicit acknowledgement and a 12-digit account ID."
  }
}
variable "aws_account_id" {
  type        = string
  default     = ""
  description = "Expected real account, enforced by provider outside local mode."
}
variable "region" {
  type        = string
  default     = "us-east-1"
  description = "Builder choice; AZs use this region's a/b suffixes."
}
variable "name" {
  type        = string
  default     = "challenge"
  description = "Resource name prefix."
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{0,24}[a-z0-9]$", var.name))
    error_message = "Use 2-26 lowercase alphanumeric/hyphen characters, starting with a letter."
  }
}
variable "api_image" {
  type        = string
  default     = "floci-challenge-api:latest"
  description = "Container image: locally pulled registry URI during emulation, ECR URI on AWS."
  validation {
    condition     = var.local_emulation || length(regexall("^[0-9]{12}\\.dkr\\.ecr\\.[a-z0-9-]+\\.amazonaws\\.com/.+", var.api_image)) > 0
    error_message = "AWS mode requires a normal ECR image URI."
  }
}
variable "local_api_origin_host" {
  type        = string
  default     = "challenge-api-alb.localhost.floci.io"
  description = "Fixed ALB origin hostname for local CloudFront emulation; the Floci container carries this Docker network alias and allowlists it for private-origin access. Unused on AWS."
  validation {
    condition     = can(regex("^[a-z0-9]([a-z0-9-]*[a-z0-9])?\\.localhost\\.floci\\.io$", var.local_api_origin_host))
    error_message = "Local custom origin host must be a <name>.localhost.floci.io hostname; the Floci compose stack must alias and allowlist exactly this value."
  }
}

variable "api_certificate_arn" {
  type        = string
  default     = ""
  description = "ACM certificate ARN for the ALB HTTPS listener; empty only for local HTTP emulation."
  validation {
    condition     = var.local_emulation || var.api_certificate_arn != ""
    error_message = "An insecure plain-HTTP AWS deployment is not a production-ready configuration; provide a certificate."
  }
}
variable "api_hostname" {
  type        = string
  default     = ""
  description = "Public hostname for the CloudFront -> ALB HTTPS origin; DNS must point it at the ALB and it must match api_certificate_arn. Empty only for local emulation."
  validation {
    condition     = var.local_emulation || can(regex("^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$", var.api_hostname))
    error_message = "AWS mode requires a hostname that matches the ALB certificate; see docs/deployment.md DNS prerequisite."
  }
}

variable "api_desired_count" {
  type        = number
  default     = 0
  description = "Bootstrap starts at zero until the image is pushed and secrets are populated."
  validation {
    condition     = var.api_desired_count >= 0 && floor(var.api_desired_count) == var.api_desired_count
    error_message = "Desired count must be a non-negative integer."
  }
}

variable "protect_database" {
  type        = bool
  default     = false
  description = "Enable deletion protection and a final snapshot; demo defaults permit deletion."
}
