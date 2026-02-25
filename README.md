# IslamicPassport — Identidade Descentralizada (SSI) para Comunidades Islâmicas

## Visão Geral

Sistema baseado em Ethereum para registro de identidade islâmica com privacidade (SSI-friendly). **Nenhum dado pessoal é armazenado on-chain** — apenas hashes (keccak256) e ponteiros opcionais (URI) para credenciais cifradas off-chain.

### Decisão de Privacidade

| Dado | On-chain | Off-chain (localStorage / JSON exportável) |
|------|----------|---------------------------------------------|
| Nome oficial | `keccak256(nome)` | Texto completo |
| Nome muçulmano | `keccak256(nome)` | Texto completo |
| Mesquita | `keccak256(mesquita)` | Texto completo |
| Credenciais (VC) | `claimHash` + `uri` opcional | JSON completo da VC |

O usuário pode **exportar** seus dados como um JSON de Verifiable Credential (VC) e **importá-los** de volta a qualquer momento.

---

## Estrutura do Projeto

```
contracts/
  IslamicPassport.sol    ← Contrato principal (Solidity ^0.8.20)
ui/
  index.html             ← Interface web
  app.js                 ← Lógica JS com ethers.js v6
  styles.css             ← Estilos
scripts/
  deploy_islamic_passport.js  ← Script de deploy para Remix
README.md                ← Este arquivo
```

---

## Passo a Passo: Deploy e Uso no Remix IDE

### 1. Abrir o Remix

Acesse [https://remix.ethereum.org](https://remix.ethereum.org).

### 2. Importar os Arquivos

Copie os arquivos do projeto para o workspace do Remix ou use o plugin "File Explorer" para importar.

### 3. Compilar o Contrato

1. Abra `contracts/IslamicPassport.sol`.
2. No painel **Solidity Compiler**:
   - Selecione o compilador `0.8.20` ou superior.
   - Habilite **optimization** (200 runs) se desejar.
   - Clique em **Compile IslamicPassport.sol**.

### 4. Deploy

#### Opção A: Remix VM (local, para testes)

1. No painel **Deploy & Run Transactions**:
   - **Environment**: `Remix VM (Cancun)` ou similar.
   - **Account**: escolha uma conta (será o admin + primeiro sheik se registrar).
2. Selecione o contrato `IslamicPassport`.
3. Clique em **Deploy**.
4. Copie o endereço do contrato implantado.

#### Opção B: Sepolia (testnet)

1. **Environment**: `Injected Provider - MetaMask`.
2. Certifique-se de estar na rede Sepolia no MetaMask.
3. Tenha SepoliaETH (obtenha em faucets como [sepoliafaucet.com](https://sepoliafaucet.com)).
4. Clique em **Deploy** e confirme no MetaMask.
5. Copie o endereço do contrato.

#### Opção C: Script de Deploy

1. Abra `scripts/deploy_islamic_passport.js` no Remix.
2. Execute via o plugin **Remix Scripting** (botão ▶ no editor).

### 5. Abrir a Interface Web

1. Sirva a pasta `ui/` com um servidor HTTP simples:
   - **VS Code**: use a extensão "Live Server".
   - **Terminal**: `npx serve ui` ou `python -m http.server 8080 --directory ui`.
   - **Remix**: se estiver usando o plugin de preview, aponte para `ui/index.html`.
2. Abra `http://localhost:<porta>/index.html` no navegador.

### 6. Configurar a UI

1. Clique em **Conectar MetaMask**.
2. No campo **Contrato**, cole o endereço do contrato implantado e clique em **Definir**.

---

## Fluxo Completo de Teste

### Passo 1 — Primeiro usuário registra (vira Sheik automaticamente)

1. Com a **Conta A** no MetaMask, vá à aba **Registro**.
2. Preencha nome oficial, nome muçulmano e mesquita.
3. Clique em **Registrar Perfil**.
4. Vá ao **Meu Painel** — você verá seu DID, userId=1, badge SHEIK, e credenciais INITIAL + SHEIK_CERTIFICATE.

### Passo 2 — Segundo usuário registra

1. Troque para a **Conta B** no MetaMask.
2. Registre-se normalmente.
3. No painel, verá userId=2 e apenas a credencial INITIAL.

### Passo 3 — Segundo usuário solicita atesto

1. Com a Conta B, vá à aba **Solicitar Atesto**.
2. Cole o endereço da Conta A (sheik) e gere o pedido JSON.
3. Copie ou baixe o JSON (enviaria ao sheik por WhatsApp/email).

### Passo 4 — Sheik emite atesto

1. Troque para a **Conta A** (sheik).
2. Vá à aba **Atestar / Promover**.
3. Cole o endereço da Conta B no campo "Endereço do muçulmano".
4. Clique em **Emitir Atesto**.
5. A Conta B agora terá uma credencial MUSLIM_ATTESTATION.

### Passo 5 — Sheik promove a Sheik

1. Ainda com a Conta A, no formulário **Promover a Sheik**, cole o endereço da Conta B.
2. Clique em **Promover a Sheik**.
3. A Conta B agora é sheik (visível na aba **Sheiks**).

### Passo 6 — Verificar

- Na aba **Sheiks**, ambas as contas aparecem na lista.
- No **Meu Painel** de cada conta, todas as credenciais são listadas com tipo, issuer, data e status.

---

## Funcionalidades do Contrato

| Função | Descrição |
|--------|-----------|
| `registerProfile(...)` | Registra perfil com hashes. Primeiro registro vira sheik. |
| `attestMuslim(...)` | Sheik atesta muçulmano. |
| `promoteToSheikh(...)` | Sheik promove outro a sheik. |
| `revokeCredential(id)` | Issuer ou admin revoga credencial. |
| `getDID(addr)` | Retorna `did:ethr:<chainId>:<address>`. |
| `getProfile(addr)` | Retorna perfil (hashes + uri). |
| `getCredentialsOf(addr)` | Lista IDs de credenciais do usuário. |
| `getCredential(id)` | Retorna dados completos de uma credencial. |
| `listSheikhs()` | Array de endereços com papel SHEIK. |
| `isSheikh(addr)` | Booleano: é sheik? |

---

## Segurança

- **AccessControl** (OpenZeppelin): roles `DEFAULT_ADMIN_ROLE` e `SHEIK_ROLE`.
- Dados pessoais **nunca** em claro on-chain.
- Mensagens de revert descritivas.
- VC JSON gerado localmente no browser antes de enviar hashes.
- Exportação/importação de dados pessoais via JSON.

---

## Tecnologias

- **Solidity ^0.8.20** + OpenZeppelin Contracts
- **ethers.js v6** (CDN)
- **HTML/CSS/JS** vanilla (sem framework)
- **Remix IDE** para compilação e deploy
