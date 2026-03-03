param(
  [string]$DbUrl = "postgres://postgres:postgres@localhost:5432/dynaacademy"
)

Write-Host "Applying schema..."
psql $DbUrl -f "database/schema.sql"

Write-Host "Applying seed..."
psql $DbUrl -f "database/seed.sql"

Write-Host "Database initialization complete."

