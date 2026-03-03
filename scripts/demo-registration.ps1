param(
  [string]$ApiBaseUrl = "http://localhost:5003/api",
  [string]$Username = "admin",
  [string]$Password = "admin123"
)

$payload = @{
  player = @{
    firstName = "Demo"
    lastName = "Player"
    dateOfBirth = "2014-06-11"
    gender = "male"
    preferredFoot = "right"
    yearsOfExperience = 2
    preferredPosition = "Midfielder"
  }
  guardian = @{
    firstName = "Demo"
    lastName = "Guardian"
    relationshipToPlayer = "Mother"
    phoneWhatsapp = "+264810000000"
    email = "guardian.demo@example.com"
    town = "Windhoek"
    region = "Khomas"
  }
  emergencyContact = @{
    fullName = "Emergency Contact"
    relationshipToPlayer = "Uncle"
    phone = "+264811111111"
    priority = 1
  }
  medical = @{
    medicalConditions = ""
    allergies = ""
    hasAsthma = $false
    emergencyTreatmentConsent = $true
  }
  training = @{
    uniformSize = "M"
  }
  billing = @{
    dueDayOfMonth = 5
  }
  consents = @{
    academyTerms = $true
    mediaPermission = $true
    dataProcessing = $true
  }
}

$login = Invoke-RestMethod -Method Post `
  -Uri "$ApiBaseUrl/auth/login" `
  -ContentType "application/json" `
  -Body (@{username=$Username; password=$Password} | ConvertTo-Json)

$token = $login.data.token

Invoke-RestMethod -Method Post `
  -Uri "$ApiBaseUrl/registrations" `
  -Headers @{ Authorization = "Bearer $token" } `
  -ContentType "application/json" `
  -Body ($payload | ConvertTo-Json -Depth 8)
