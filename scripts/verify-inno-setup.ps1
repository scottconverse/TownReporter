param([Parameter(Mandatory=$true)][string]$InstallerPath)
$ErrorActionPreference = 'Stop'
# SHA256 published on the official is-6_4_3 GitHub release asset.
$expected = 'f3c42116542c4cc57263c5ba6c4feabfc49fe771f2f98a79d2f7628b8762723b'
if ((Get-FileHash -LiteralPath $InstallerPath -Algorithm SHA256).Hash.ToLowerInvariant() -cne $expected) {
  throw 'Inno Setup 6.4.3 installer checksum mismatch.'
}
