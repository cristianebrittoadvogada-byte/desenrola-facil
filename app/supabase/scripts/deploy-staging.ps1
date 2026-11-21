param(
  [switch]$Apply
)

$ErrorActionPreference = 'Stop'
$ProjectRef = 'nmkneyzyxxhebkurgimh'
$ExpectedProjectName = 'desenrola-facil-homologacao'
$SupabaseDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$WorkspaceRoot = (Resolve-Path (Join-Path $SupabaseDir '..\..')).Path
$Cli = Join-Path $SupabaseDir 'node_modules\.bin\supabase.CMD'
$Node = (Get-Command node -ErrorAction Stop).Source

if (-not (Test-Path -LiteralPath $Cli)) {
  throw 'A CLI Supabase local não está instalada. Nenhuma operação remota foi executada.'
}

$Config = Get-Content -LiteralPath (Join-Path $SupabaseDir 'config.toml') -Raw
if ($Config -notmatch '(?m)^project_id\s*=\s*"nmkneyzyxxhebkurgimh"\s*$') {
  throw 'O project_id local não corresponde ao alvo homologado. Nenhuma operação remota foi executada.'
}

$RequiredMigrations = @(
  '202611190001_fase1_foundation.sql',
  '202611190002_meta_channels_foundation.sql',
  '202611190003_automation_payments.sql',
  '202611200001_business_completion.sql',
  '202611200002_contracts.sql'
)
$MigrationDir = Join-Path $SupabaseDir 'migrations'
$FoundMigrations = @(Get-ChildItem -LiteralPath $MigrationDir -File -Filter '*.sql' | Sort-Object Name)
if (($FoundMigrations.Name -join '|') -ne ($RequiredMigrations -join '|')) {
  throw 'A lista de migrações locais não é a lista revisada de homologação. Nenhuma operação remota foi executada.'
}
foreach ($Migration in $FoundMigrations) {
  $Sql = Get-Content -LiteralPath $Migration.FullName -Raw
  if ($Sql -notmatch '(?is)^\s*--.*?\bbegin\s*;' -or $Sql -notmatch '(?is)\bcommit\s*;\s*$') {
    throw "Migração fora de transação: $($Migration.Name). Nenhuma operação remota foi executada."
  }
  if ($Sql -match '(?i)\bdrop\s+(table|schema|database|role|policy|function|trigger)\b|\btruncate\b|\bdelete\s+from\b') {
    throw "Comando destrutivo encontrado em $($Migration.Name). Nenhuma operação remota foi executada."
  }
}

function Invoke-Supabase {
  param([string[]]$Arguments, [switch]$Capture)
  $Output = & $Cli @Arguments 2>&1
  if ($LASTEXITCODE -ne 0) {
    $Label = if ($Arguments.Count -gt 0) { $Arguments[0] } else { 'command' }
    throw "Supabase CLI falhou em '$Label' (código $LASTEXITCODE). Nenhuma próxima etapa foi executada. A saída detalhada foi omitida para evitar registrar informação sensível."
  }
  if ($Capture) { return ($Output -join "`n") }
  $Output | ForEach-Object { Write-Host $_ }
}

# Confirm access to this exact ref before reading migration state or writing.
$ProjectList = Invoke-Supabase -Arguments @('projects','list','--output-format','json') -Capture
try { $ProjectData = ConvertFrom-Json -InputObject $ProjectList } catch {
  throw 'A CLI não retornou a lista de projetos em JSON válido. Nenhuma operação remota foi executada.'
}
$ProjectRows = if ($ProjectData.projects) { @($ProjectData.projects) } else { @($ProjectData) }
$Target = @($ProjectRows | Where-Object { $_.id -eq $ProjectRef -or $_.ref -eq $ProjectRef }) | Select-Object -First 1
if (-not $Target) { throw 'A CLI autenticada não listou o projeto autorizado. Nenhuma alteração foi executada.' }
if ($Target.name -and $Target.name -ne $ExpectedProjectName) {
  throw 'A referência existe, mas o nome do projeto não corresponde à homologação esperada. Nenhuma alteração foi executada.'
}
Write-Host "Projeto confirmado pela CLI: ref=$ProjectRef; nome=$($Target.name)"

Write-Host 'Histórico remoto de migrações:'
Invoke-Supabase -Arguments @('migration','list',"--remote=$ProjectRef")
Write-Host 'Plano do banco (dry-run, sem Vault e sem seed):'
Invoke-Supabase -Arguments @('db','push',"--remote=$ProjectRef",'--dry-run','--skip-vault')

if (-not $Apply) {
  Write-Host 'Pré-verificação concluída. Nenhuma alteração remota foi executada. Use -Apply somente após confirmar backup e restauração.'
  exit 0
}

$BackupVars = @('PGHOST','PGPORT','PGDATABASE','PGUSER','PGPASSWORD','PGSSLMODE','BACKUP_ENCRYPTION_KEY','BACKUP_PATH')
$MissingBackupVars = @($BackupVars | Where-Object { [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($_)) })
if ($MissingBackupVars.Count -gt 0) {
  throw 'Backup cifrado não está configurado no ambiente seguro. Nenhuma migração foi aplicada.'
}
$BackupPath = [System.IO.Path]::GetFullPath($env:BACKUP_PATH)
$WorkspacePrefix = $WorkspaceRoot.TrimEnd('\') + '\'
if ($BackupPath.StartsWith($WorkspacePrefix,[System.StringComparison]::OrdinalIgnoreCase)) {
  throw 'O backup precisa ficar fora do workspace. Nenhuma migração foi aplicada.'
}

Write-Host 'Criando backup cifrado antes da implantação...'
& $Node (Join-Path $PSScriptRoot 'db-maintenance.mjs') backup
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $BackupPath) -or (Get-Item -LiteralPath $BackupPath).Length -lt 32) {
  throw 'O backup não foi comprovado. Nenhuma migração foi aplicada.'
}

Write-Host 'Aplicando somente as migrações locais ao projeto autorizado; secrets do Vault e seed ficam desativados.'
Invoke-Supabase -Arguments @('db','push',"--remote=$ProjectRef",'--skip-vault','--yes')
Write-Host 'Implantando as Edge Functions locais sem usar Docker.'
Invoke-Supabase -Arguments @('functions','deploy','api','payments','meta-webhook','asaas-webhook',"--remote=$ProjectRef",'--use-api')
Write-Host 'Histórico remoto após a implantação:'
Invoke-Supabase -Arguments @('migration','list',"--remote=$ProjectRef")
