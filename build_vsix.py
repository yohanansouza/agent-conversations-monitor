"""Empacota a extensão local em scratch, sem dependências externas."""
import pathlib
import json
import zipfile

root = pathlib.Path(__file__).resolve().parent
version = json.loads((root / "package.json").read_text(encoding="utf-8"))["version"]
out = root / "dist" / f"agent-conversations-monitor-{version}.vsix"
manifest = f'''<?xml version="1.0" encoding="utf-8"?><PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011"><Metadata><Identity Language="en-US" Id="antigravity-conversations-monitor" Version="{version}" Publisher="bottrade-local"/><DisplayName>Monitor de Agentes</DisplayName><Description xml:space="preserve">Monitor local de conversas</Description></Metadata><Installation><InstallationTarget Id="Microsoft.VisualStudio.Code"/></Installation><Dependencies/><Assets><Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/></Assets></PackageManifest>'''
content_types = '''<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="json" ContentType="application/json"/><Default Extension="js" ContentType="application/javascript"/><Default Extension="css" ContentType="text/css"/><Default Extension="svg" ContentType="image/svg+xml"/><Default Extension="md" ContentType="text/markdown"/><Default Extension="vsixmanifest" ContentType="text/xml"/></Types>'''
out.parent.mkdir(exist_ok=True)
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as archive:
    archive.writestr("extension.vsixmanifest", manifest)
    archive.writestr("[Content_Types].xml", content_types)
    allowed = {"package.json", "extension.js", "native-view.js", "sessions.js", "codex-sessions.js", "antigravity-links.js", "other-sessions.js", "notifications.js", "README.md", "README.pt-BR.md", "LICENSE"}
    for file in root.rglob("*"):
        relative = file.relative_to(root)
        if file.is_file() and (relative.as_posix() in allowed or (relative.parts[0] == "media" and file.suffix in {".js", ".css", ".svg", ".md"})):
            archive.write(file, "extension/" + relative.as_posix())
print(out)
