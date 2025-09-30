# ExpedicaoIntegral App (Flutter)

Este projeto Flutter é um app de controle de expedições, incluindo autenticação com 2FA, gestão de tickets de balança e integração com backend.

---

## 🌱 Começando com desenvolvimento

### Pré-requisitos

- Flutter SDK instalado
- Git
- Editor (VSCode recomendado)
- Backend já configurado e acessível (API)

### Passos para rodar o projeto em dev

```bash
git clone <repo-url>
cd expedicoeintegral
flutter pub get
flutter run
```

### Configurações específicas

- O backend esperado é acessado via `dio` com rotas como:
  - `/auth/login_v2`
  - `/auth/autenticar-2fa`
  - `/produto`
  - `/expedicoes_v2`

- O sistema utiliza token JWT com access e refresh, gravados via `FlutterSecureStorage`.

---

## 🚀 Subir para produção

### 1. Atualizar versão do app

Edite o `pubspec.yaml`:

```yaml
version: 1.0.5+5
```

### 2. Gerar build release

```bash
flutter build apk --release
```

Ou para web:

```bash
flutter build web
```

### 3. Testar o build

Teste o APK ou a pasta `build/web` localmente antes de subir.

---

## 🔀 Git Workflow

- Branch principal: `main`
- Branch de desenvolvimento: `refactor` (pode ser outras como `feature/x`)
- Versões antigas podem ser marcadas via `tag`, ex:

```bash
git tag v1.0.4-base
git push origin v1.0.4-base
```

---

## ✅ Boas práticas

- Commits claros e pequenos
- Utilize `.env` para configurações sensíveis
- Mantenha o código modular (ex: separar auth, pages, utils)

---

Feito com 💙 por [sua equipe]
# teste
