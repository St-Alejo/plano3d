; Instalador de Plano 3D para Windows (Inno Setup 6).
; Lo compila scripts/build-release.ps1 después de exportar la app con Godot a build/app/:
;   ISCC /DMyAppVersion=1.0.0 installer\plano3d.iss   →   build\Plano3D-Setup.exe
; Instala por usuario (sin pedir administrador) y registra el protocolo plano3d:// en HKCU para
; que «Abrir en escritorio» de la web abra la app en el proyecto.

#define MyAppName "Plano 3D"
#ifndef MyAppVersion
  #define MyAppVersion "1.0.0"
#endif
#define MyAppExe "Plano3D.exe"
#define MyAppUrl "https://lively-island-09e124b1e.5.azurestaticapps.net"

[Setup]
AppId={{8F2B6C1E-5A3D-4E8B-9C71-3D2F0A6B4E15}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppName}
AppPublisherURL={#MyAppUrl}
AppSupportURL={#MyAppUrl}/escritorio
AppUpdatesURL={#MyAppUrl}/escritorio
VersionInfoVersion={#MyAppVersion}
DefaultDirName={localappdata}\Programs\Plano 3D
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
DisableDirPage=auto
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputDir=..\build
OutputBaseFilename=Plano3D-Setup
SetupIconFile=plano3d.ico
UninstallDisplayIcon={app}\plano3d.ico
UninstallDisplayName={#MyAppName}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes

[Languages]
Name: "spanish"; MessagesFile: "compiler:Languages\Spanish.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "..\build\app\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "plano3d.ico"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExe}"; IconFilename: "{app}\plano3d.ico"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExe}"; IconFilename: "{app}\plano3d.ico"; Tasks: desktopicon

[Registry]
; plano3d://open?project=…&code=… → "Plano3D.exe" "plano3d://…"
Root: HKCU; Subkey: "Software\Classes\plano3d"; ValueType: string; ValueName: ""; ValueData: "URL:Plano 3D"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\plano3d"; ValueType: string; ValueName: "URL Protocol"; ValueData: ""
Root: HKCU; Subkey: "Software\Classes\plano3d\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\plano3d.ico"
Root: HKCU; Subkey: "Software\Classes\plano3d\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#MyAppExe}"" ""%1"""

[Run]
Filename: "{app}\{#MyAppExe}"; Description: "{cm:LaunchProgram,{#MyAppName}}"; Flags: nowait postinstall skipifsilent
