# Tutorial Completo — IslamicPassport

## O que é este sistema?

O **IslamicPassport** é um sistema de identidade descentralizada (SSI) para comunidades islâmicas, rodando na blockchain Ethereum. Ele permite:

- Registrar sua identidade islâmica (nome oficial, nome muçulmano, mesquita)
- Receber certificados digitais verificáveis
- Ter um sheik atestando que você é muçulmano
- Ser promovido a sheik por outro sheik

**Privacidade:** seus dados pessoais **nunca** são enviados à blockchain. Apenas hashes (impressões digitais criptográficas) são gravados on-chain. Seus dados ficam salvos localmente no navegador.

---

## Pré-requisitos

Antes de começar, você precisa de:

1. **Navegador** — Chrome, Firefox ou Brave (versão recente)
2. **MetaMask** — extensão de carteira Ethereum instalada no navegador
   - Instale em: https://metamask.io/download/
3. **Remix IDE** — ambiente online para compilar e fazer deploy do contrato
   - Acesse: https://remix.ethereum.org
4. **Servidor HTTP local** (para a UI) — qualquer um destes:
   - Extensão "Live Server" do VS Code
   - Ou via terminal: `npx serve ui` ou `python -m http.server 8080`

---

## PARTE 1 — Preparar o MetaMask

### Passo 1.1 — Instalar MetaMask

1. Acesse https://metamask.io/download/
2. Clique em "Install MetaMask for Chrome" (ou seu navegador)
3. Siga as instruções para criar uma carteira (guarde a frase de recuperação!)

### Passo 1.2 — Criar pelo menos 2 contas no MetaMask

Você precisa de **2 contas** para testar o fluxo completo (uma será o sheik, outra o muçulmano).

1. Abra o MetaMask → clique no ícone de perfil (canto superior direito)
2. Clique em **"+ Adicionar conta"** ou **"Create Account"**
3. Dê um nome: ex. "Conta A (Sheik)" e "Conta B (Muçulmano)"

### Passo 1.3 — Escolher a rede

Você tem duas opções:

**Opção A — Remix VM (mais fácil, sem custo, tudo local):**
- Não precisa configurar nada no MetaMask para isso
- O deploy será feito diretamente no Remix usando a VM interna
- ⚠️ Porém, a UI web não consegue se conectar à Remix VM. Use esta opção apenas para testar o contrato diretamente no Remix.

**Opção B — Sepolia Testnet (recomendado para testar a UI):**
1. No MetaMask, clique na lista de redes (topo)
2. Ative "Show test networks" nas configurações
3. Selecione **"Sepolia"**
4. Obtenha ETH de teste (gratuito):
   - Acesse https://sepoliafaucet.com ou https://www.alchemy.com/faucets/ethereum-sepolia
   - Cole seu endereço e receba SepoliaETH

---

## PARTE 2 — Compilar e Fazer Deploy do Contrato

### Passo 2.1 — Abrir o Remix IDE

1. Acesse https://remix.ethereum.org
2. No painel esquerdo, clique em **"File Explorer"** (ícone de pasta)

### Passo 2.2 — Carregar o contrato

1. No File Explorer do Remix, crie a pasta `contracts/` (se não existir)
2. Crie um arquivo chamado `IslamicPassport.sol`
3. Copie e cole **todo o conteúdo** do arquivo `contracts/IslamicPassport.sol` deste projeto

### Passo 2.3 — Compilar

1. No painel esquerdo, clique no ícone **"Solidity Compiler"** (ícone com "S")
2. Garanta que o compilador está na versão **0.8.20** ou superior
3. Clique em **"Compile IslamicPassport.sol"**
4. Se aparecer um ✅ verde, compilou com sucesso!
5. Se houver erro, verifique se o código foi copiado corretamente

### Passo 2.4 — Deploy

1. No painel esquerdo, clique no ícone **"Deploy & Run Transactions"** (ícone com seta)
2. Configure o **Environment**:

   **Se vai usar Remix VM (teste rápido do contrato):**
   - Selecione `Remix VM (Cancun)`
   - Escolha a primeira conta da lista (será o admin)

   **Se vai usar Sepolia (teste completo com UI):**
   - Selecione `Injected Provider - MetaMask`
   - O MetaMask vai abrir pedindo permissão — confirme
   - Certifique-se de estar na rede Sepolia

3. No campo **"Contract"**, selecione `IslamicPassport`
4. Clique em **"Deploy"**
5. Se estiver no MetaMask, confirme a transação

### Passo 2.5 — Copiar o endereço do contrato

1. Após o deploy, no painel inferior do Remix, em **"Deployed Contracts"**, aparece o contrato
2. Clique no ícone de **copiar** ao lado do endereço (ex: `0x1234...abcd`)
3. **Guarde esse endereço!** Você vai precisar dele na UI

---

## PARTE 3 — Abrir a Interface Web (UI)

### Passo 3.1 — Iniciar um servidor HTTP local

Abra um terminal na pasta raiz do projeto e execute **um** destes comandos:

```bash
# Opção 1: usando npx (Node.js necessário)
npx serve ui

# Opção 2: usando Python
python -m http.server 8080 --directory ui

# Opção 3: usando VS Code
# Clique com o botão direito em ui/index.html → "Open with Live Server"
```

### Passo 3.2 — Abrir no navegador

Acesse no navegador:
- Se usou `npx serve`: http://localhost:3000
- Se usou Python: http://localhost:8080
- Se usou Live Server: abre automaticamente

Você verá a interface do IslamicPassport com o cabeçalho verde e as abas.

### Passo 3.3 — Conectar o MetaMask

1. Clique no botão **"Conectar MetaMask"** (canto superior direito)
2. O MetaMask vai abrir — selecione a **Conta A** e confirme
3. A UI mostrará o endereço encurtado e o chainId

### Passo 3.4 — Configurar o endereço do contrato

1. No campo **"Contrato:"** (barra logo abaixo do cabeçalho), cole o endereço copiado no Passo 2.5
2. Clique em **"Definir"**
3. Deve aparecer a mensagem "Contrato configurado: 0x1234...abcd"

---

## PARTE 4 — Fluxo Completo de Teste

### Teste 1 — Registrar o primeiro usuário (vira Sheik automaticamente)

> **Use a Conta A no MetaMask**

1. Na aba **"Registro"**, preencha:
   - **Nome Oficial:** `Muhammad ibn Abdullah`
   - **Nome Muçulmano:** `Abu Bakr`
   - **Mesquita:** `Mesquita Central de São Paulo`
   - **URI off-chain:** (deixe vazio)
2. Clique em **"Registrar Perfil"**
3. Confirme a transação no MetaMask
4. Aguarde a confirmação (alguns segundos na Sepolia)
5. A UI vai redirecionar para **"Meu Painel"**

**O que você deve ver no Meu Painel:**
- ✅ Seu **DID**: `did:ethr:<chainId>:<seuEndereço>`
- ✅ **User ID**: `1`
- ✅ Badge dourado: **SHEIK** (porque é o primeiro registro!)
- ✅ **2 credenciais**:
  - `INITIAL` — certificado de registro (emitido pelo contrato)
  - `SHEIK_CERTIFICATE` — certificado de sheik automático

### Teste 2 — Exportar seus dados como VC JSON

1. Ainda no **"Meu Painel"**, clique em **"Exportar VC JSON (dados locais)"**
2. Um arquivo `.json` será baixado com seus dados pessoais completos
3. Este arquivo contém seus dados reais — guarde-o com segurança!
4. Na blockchain, só existem os hashes — ninguém consegue recuperar seus dados a partir deles

### Teste 3 — Registrar o segundo usuário

1. **Troque de conta no MetaMask**: clique no ícone de perfil → selecione **Conta B**
2. A página vai recarregar automaticamente
3. Vá à aba **"Registro"** e preencha:
   - **Nome Oficial:** `Fatima bint Ahmad`
   - **Nome Muçulmano:** `Khadijah`
   - **Mesquita:** `Mesquita Central de São Paulo`
4. Clique em **"Registrar Perfil"** e confirme no MetaMask

**O que você deve ver no Meu Painel:**
- ✅ **User ID**: `2`
- ✅ **Sem badge** de SHEIK (é um usuário comum)
- ✅ **1 credencial**: apenas `INITIAL`

### Teste 4 — Solicitar atesto ao sheik (off-chain)

1. Com a **Conta B** ativa, vá à aba **"Solicitar Atesto"**
2. No campo **"Endereço do Sheik"**, cole o endereço da **Conta A**
3. Em **"Mensagem adicional"**, escreva algo como: `Frequento a mesquita há 5 anos`
4. Clique em **"Gerar Pedido"**
5. Um JSON aparece na tela — clique em **"Copiar"** ou **"Download JSON"**
6. Na vida real, você enviaria este JSON ao sheik via WhatsApp, email, etc.

> ⚠️ Esse pedido **não vai para a blockchain** — é apenas um documento para comunicação entre vocês.

### Teste 5 — Sheik emite atesto de muçulmano

1. **Troque para a Conta A** (o sheik) no MetaMask
2. Vá à aba **"Atestar / Promover"**
3. Na seção **"Atestar Muçulmano"**:
   - **Endereço do muçulmano:** cole o endereço da **Conta B**
   - **URI off-chain:** (deixe vazio)
4. Clique em **"Emitir Atesto"** e confirme no MetaMask

**Verificação:**
- Troque para a Conta B → **"Meu Painel"**
- Agora você deve ver **2 credenciais**: `INITIAL` + `MUSLIM_ATTESTATION`
- A credencial `MUSLIM_ATTESTATION` mostra o sheik como issuer

### Teste 6 — Sheik promove outro usuário a Sheik

1. **Troque para a Conta A** (sheik) no MetaMask
2. Na aba **"Atestar / Promover"**, seção **"Promover a Sheik"**:
   - **Endereço do novo sheik:** cole o endereço da **Conta B**
3. Clique em **"Promover a Sheik"** e confirme no MetaMask

**Verificação:**
- Troque para a Conta B → **"Meu Painel"**
- Agora aparece o badge **SHEIK** 🎉
- Há **3 credenciais**: `INITIAL` + `MUSLIM_ATTESTATION` + `SHEIK_CERTIFICATE`

### Teste 7 — Listar sheiks

1. Vá à aba **"Sheiks"**
2. Clique em **"Atualizar Lista"**
3. Você deve ver **2 endereços** na tabela:
   - Conta A (sheik original)
   - Conta B (promovida a sheik)

### Teste 8 — Revogar uma credencial

1. Com a **Conta A** (que emitiu o atesto), vá à aba **"Atestar / Promover"**
2. Na seção **"Revogar Credencial"**:
   - **ID da Credencial:** digite o número da credencial a revogar (ex: `3` para o MUSLIM_ATTESTATION)
3. Clique em **"Revogar"** e confirme

**Verificação:**
- Troque para a Conta B → **"Meu Painel"**
- A credencial revogada aparece com a tag vermelha **REVOGADA** e visual esmaecido

---

## PARTE 5 — Resumo das Abas da UI

| Aba | O que faz |
|-----|-----------|
| **Registro** | Preencher dados pessoais e registrar perfil (hashes on-chain) |
| **Meu Painel** | Ver seu DID, userId, badge de sheik, todas as credenciais, exportar/importar VC JSON |
| **Sheiks** | Listar todos os endereços que têm o papel de sheik |
| **Atestar / Promover** | (Somente sheiks) Emitir atesto de muçulmano, promover a sheik, revogar credenciais |
| **Solicitar Atesto** | Gerar pedido JSON off-chain para enviar a um sheik |

---

## PARTE 6 — Solução de Problemas

### "MetaMask não encontrado"
- Instale a extensão MetaMask no navegador
- Certifique-se de que está habilitada

### "Endereço de contrato inválido"
- Verifique se copiou o endereço completo (começa com `0x`, tem 42 caracteres)
- Verifique se o contrato foi implantado na mesma rede que o MetaMask está conectado

### "IslamicPassport: perfil ja registrado"
- Cada endereço só pode registrar um perfil. Use outra conta.

### "IslamicPassport: sem permissao para revogar"
- Apenas o issuer da credencial ou o admin (deployer) pode revogar

### "IslamicPassport: subject nao registrado"
- O endereço que você está tentando atestar/promover precisa ter feito o registro primeiro

### "IslamicPassport: subject ja e sheik"
- O endereço já possui o papel de sheik. Não pode ser promovido novamente.

### Transação pendente por muito tempo (Sepolia)
- A rede pode estar congestionada. Aguarde ou aumente o gas no MetaMask.

### A UI não conecta ao contrato da Remix VM
- A Remix VM é interna ao Remix. Para usar a UI, faça deploy na Sepolia ou em uma rede local (Hardhat/Ganache) que o MetaMask possa acessar.

---

## PARTE 7 — Entendendo a Privacidade (SSI)

```
┌─────────────────────────────────────────────────────┐
│                    SEU NAVEGADOR                     │
│                                                      │
│  Dados reais ──► keccak256 ──► hash (32 bytes)      │
│  "Muhammad"       função        0xabc123...          │
│                   de hash                            │
│                                                      │
│  Dados reais salvos em:                              │
│  • localStorage do navegador                         │
│  • Arquivo JSON exportável (VC)                      │
└──────────────────────┬──────────────────────────────┘
                       │ só o hash vai
                       ▼
┌─────────────────────────────────────────────────────┐
│                   BLOCKCHAIN                         │
│                                                      │
│  Armazena APENAS:                                    │
│  • hNomeOficial  = 0xabc123...                      │
│  • hNomeMuculmano = 0xdef456...                     │
│  • hMesquita     = 0x789ghi...                      │
│  • claimHash das credenciais                         │
│  • URI opcional (para VC cifrada em IPFS)            │
│                                                      │
│  ❌ NÃO armazena nomes, mesquitas ou dados pessoais │
└─────────────────────────────────────────────────────┘
```

Ninguém que leia a blockchain consegue saber seus dados pessoais. Os hashes são irreversíveis.

---

## Checklist Final

- [ ] MetaMask instalado com pelo menos 2 contas
- [ ] Contrato compilado e implantado (Remix VM ou Sepolia)
- [ ] Endereço do contrato copiado
- [ ] UI rodando em servidor local
- [ ] MetaMask conectado à UI
- [ ] Endereço do contrato configurado na UI
- [ ] Conta A registrada (virou sheik automático)
- [ ] Conta B registrada
- [ ] Conta B solicitou atesto (JSON off-chain)
- [ ] Conta A emitiu atesto para Conta B
- [ ] Conta A promoveu Conta B a sheik
- [ ] Ambas aparecem na lista de sheiks
- [ ] Credenciais verificadas no painel de cada conta
- [ ] (Opcional) Credencial revogada com sucesso
- [ ] (Opcional) VC JSON exportado/importado
