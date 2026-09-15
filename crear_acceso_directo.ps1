$shell = New-Object -ComObject WScript.Shell
$desktop = [System.Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop 'VALEVENTAS POS.lnk'
$targetPath = Join-Path $PSScriptRoot 'iniciar_valeventas.bat'

$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $targetPath
$shortcut.WorkingDirectory = $PSScriptRoot
$shortcut.Description = 'VALEVENTAS POS by VT VALETEC'
$shortcut.Save()

Write-Host '[OK] Acceso directo creado exitosamente en el Escritorio!' -ForegroundColor Green