# Tutorial de Solidity — Do Zero ao Contrato Inteligente

> Este tutorial usa o contrato `IslamicPassport.sol` deste projeto como exemplo prático.
> Cada conceito é explicado e depois mostrado no código real.

---

## Sumário

1. [O que é Solidity?](#1--o-que-é-solidity)
2. [Estrutura básica de um contrato](#2--estrutura-básica-de-um-contrato)
3. [Pragma e versão do compilador](#3--pragma-e-versão-do-compilador)
4. [Imports](#4--imports)
5. [Contrato e herança](#5--contrato-e-herança)
6. [Tipos de dados](#6--tipos-de-dados)
7. [Variáveis de estado](#7--variáveis-de-estado)
8. [Visibilidade (public, private, internal, external)](#8--visibilidade)
9. [Enums](#9--enums)
10. [Structs](#10--structs)
11. [Mappings](#11--mappings)
12. [Arrays](#12--arrays)
13. [Events (Eventos)](#13--events-eventos)
14. [Modifiers (Modificadores)](#14--modifiers-modificadores)
15. [Constructor (Construtor)](#15--constructor-construtor)
16. [Functions (Funções)](#16--functions-funções)
17. [Require e Revert (Tratamento de erros)](#17--require-e-revert)
18. [Variáveis globais (msg.sender, block.timestamp, etc.)](#18--variáveis-globais)
19. [Herança e AccessControl (OpenZeppelin)](#19--herança-e-accesscontrol)
20. [Gas e otimização](#20--gas-e-otimização)
21. [Resumo visual](#21--resumo-visual)

---

## 1 — O que é Solidity?

**Solidity** é a linguagem de programação usada para escrever **contratos inteligentes** (smart contracts) na blockchain Ethereum e em outras blockchains compatíveis com a EVM (Ethereum Virtual Machine).

Um contrato inteligente é um programa que:
- Vive na blockchain (é imutável após o deploy)
- Tem um endereço próprio (como uma conta)
- Executa lógica automaticamente quando alguém chama suas funções
- Pode armazenar dados permanentemente (estado)
- Cobra **gas** (taxa) para executar operações

**Analogia simples:** pense num contrato inteligente como uma máquina de vendas. Ela tem regras programadas (se você colocar X moedas, recebe Y produto) e ninguém pode alterar essas regras depois que a máquina é colocada em funcionamento.

---

## 2 — Estrutura básica de um contrato

Todo arquivo Solidity segue esta estrutura geral:

```solidity
// 1. Licença
// SPDX-License-Identifier: MIT

// 2. Versão do compilador
pragma solidity ^0.8.20;

// 3. Imports (bibliotecas externas)
import "@openzeppelin/contracts/access/AccessControl.sol";

// 4. Definição do contrato
contract MeuContrato is AccessControl {

    // 5. Variáveis de estado (dados armazenados na blockchain)
    uint256 public contador;

    // 6. Eventos (logs que ficam na blockchain)
    event ContadorAlterado(uint256 novoValor);

    // 7. Construtor (executado uma única vez no deploy)
    constructor() {
        contador = 0;
    }

    // 8. Funções (a lógica do contrato)
    function incrementar() external {
        contador += 1;
        emit ContadorAlterado(contador);
    }
}
```

Vamos detalhar cada parte.

---

## 3 — Pragma e versão do compilador

```solidity
pragma solidity ^0.8.20;
```

- `pragma` é uma **diretiva** que diz ao compilador qual versão usar
- `^0.8.20` significa: "compile com 0.8.20 ou qualquer versão 0.8.x superior, mas NÃO 0.9.0"
- Isso garante compatibilidade e evita bugs de versões futuras

**No IslamicPassport:**
```solidity
pragma solidity ^0.8.20;
```

---

## 4 — Imports

```solidity
import "@openzeppelin/contracts/access/AccessControl.sol";
```

- `import` traz código de outros arquivos para dentro do seu contrato
- **OpenZeppelin** é uma biblioteca de contratos auditados e seguros, muito usada na indústria
- `@openzeppelin/contracts/...` é resolvido automaticamente pelo Remix ou pelo gerenciador de pacotes (npm/forge)

**Analogia:** é como o `import` do Python ou o `require` do JavaScript — você está reutilizando código já pronto e testado.

**No IslamicPassport** importamos `AccessControl`, que nos dá um sistema de papéis (roles) pronto:
```solidity
import "@openzeppelin/contracts/access/AccessControl.sol";
```

---

## 5 — Contrato e herança

```solidity
contract IslamicPassport is AccessControl {
    // ...
}
```

- `contract` é a palavra-chave para definir um contrato (equivalente a `class` em outras linguagens)
- `is AccessControl` significa que `IslamicPassport` **herda** de `AccessControl`
- Herança significa que o nosso contrato ganha todas as funções e variáveis do `AccessControl`

**Herança múltipla** também é possível:
```solidity
contract MeuContrato is AccessControl, Pausable, ReentrancyGuard {
    // Herda de 3 contratos ao mesmo tempo
}
```

**Analogia:** herança em Solidity funciona exatamente como herança em orientação a objetos — o filho herda tudo do pai.

---

## 6 — Tipos de dados

Solidity é uma linguagem **fortemente tipada** — toda variável tem um tipo definido.

### Tipos primitivos

| Tipo | Descrição | Exemplo |
|------|-----------|---------|
| `bool` | Verdadeiro ou falso | `bool ativo = true;` |
| `uint256` | Inteiro sem sinal (0 a 2²⁵⁶-1) | `uint256 idade = 25;` |
| `int256` | Inteiro com sinal (-2²⁵⁵ a 2²⁵⁵-1) | `int256 saldo = -100;` |
| `address` | Endereço Ethereum (20 bytes) | `address dono = msg.sender;` |
| `bytes32` | Sequência fixa de 32 bytes | `bytes32 hash = keccak256("abc");` |
| `string` | Texto de tamanho variável | `string nome = "Ali";` |

### Por que `uint256` e não `int`?

- Na blockchain, usamos muito números positivos (IDs, contadores, timestamps)
- `uint256` é o tipo padrão e o mais eficiente em gas
- `uint8`, `uint16`, `uint128` também existem, mas geralmente `uint256` é mais barato em gas por ser o tamanho nativo da EVM

### `bytes32` — o tipo mais importante para hashes

No IslamicPassport, usamos `bytes32` para armazenar hashes:

```solidity
bytes32 hNomeOficial;    // keccak256 do nome oficial
bytes32 hNomeMuculmano;  // keccak256 do nome muçulmano
bytes32 hMesquita;       // keccak256 da mesquita
```

`bytes32` armazena exatamente 32 bytes — que é o tamanho do resultado de `keccak256`, a função de hash do Ethereum.

### `address` — endereços Ethereum

```solidity
address user = 0x1234567890123456789012345678901234567890;
address contrato = address(this); // endereço do próprio contrato
```

- Todo contrato e toda carteira tem um `address`
- `address(this)` = o endereço do contrato atual
- `msg.sender` = o endereço de quem chamou a função

---

## 7 — Variáveis de estado

Variáveis de estado são dados armazenados **permanentemente na blockchain**. Cada escrita custa gas.

```solidity
contract IslamicPassport is AccessControl {

    // Variáveis de estado — ficam na blockchain para sempre
    uint256 private _nextUserId = 1;
    uint256 private _nextCredentialId = 1;
    uint256 public deployChainId;

    mapping(address => Profile) private _profiles;
    mapping(uint256 => Credential) private _credentials;
    address[] private _sheikhs;
}
```

**Convenção de nomenclatura:**
- `_underscorePrefixo` → variáveis privadas/internas
- `semUnderscore` → variáveis públicas
- `MAIÚSCULAS` → constantes

### Constantes e Immutables

```solidity
// Constante: valor definido em tempo de compilação, NÃO custa gas de storage
bytes32 public constant SHEIK_ROLE = keccak256("SHEIK_ROLE");

// Immutable: definido no construtor, depois nunca muda
uint256 public immutable deployChainId;
```

| Tipo | Quando é definido | Pode mudar? | Custo de gas |
|------|-------------------|-------------|--------------|
| `constant` | Compilação | Não | Zero (inline) |
| `immutable` | Construtor | Não | Muito baixo |
| Normal | Qualquer hora | Sim | Alto |

---

## 8 — Visibilidade

Toda variável e função em Solidity tem uma **visibilidade** que controla quem pode acessá-la.

| Visibilidade | Quem pode acessar | Onde usar |
|---|---|---|
| `public` | Qualquer um (externo + interno + contratos filhos) | Variáveis que precisam de getter automático; funções que qualquer um chama |
| `external` | Somente chamadas externas (não pode ser chamada internamente com `this`) | Funções da API pública do contrato |
| `internal` | O próprio contrato + contratos que herdam dele | Funções auxiliares que filhos podem usar |
| `private` | Somente o próprio contrato | Dados e funções internas exclusivas |

**No IslamicPassport:**
```solidity
// public → qualquer um pode ler
uint256 public deployChainId;
bytes32 public constant SHEIK_ROLE = keccak256("SHEIK_ROLE");

// private → só o contrato acessa
uint256 private _nextUserId = 1;
mapping(address => Profile) private _profiles;

// external → funções chamadas de fora (pela UI, por exemplo)
function registerProfile(...) external { ... }

// internal → funções auxiliares usadas dentro do contrato
function _issueCredential(...) internal returns (uint256) { ... }
```

> **Importante:** `private` em Solidity **NÃO** esconde dados da blockchain! Qualquer pessoa pode ler o storage de um contrato. `private` apenas impede que **outros contratos** acessem a variável diretamente.

---

## 9 — Enums

Enums definem um conjunto fixo de valores nomeados. Internamente, são armazenados como inteiros (0, 1, 2...).

```solidity
enum CredentialType {
    INITIAL,             // = 0
    MUSLIM_ATTESTATION,  // = 1
    SHEIK_CERTIFICATE    // = 2
}
```

**Como usar:**
```solidity
CredentialType tipo = CredentialType.INITIAL; // tipo = 0
CredentialType tipo2 = CredentialType.SHEIK_CERTIFICATE; // tipo2 = 2
```

**Analogia:** é como um `enum` em Java, C# ou TypeScript — um conjunto fechado de opções.

**No IslamicPassport**, usamos o enum para diferenciar os 3 tipos de certificado digital.

---

## 10 — Structs

Structs agrupam vários dados relacionados numa única entidade — como um "objeto" ou "registro".

```solidity
struct Profile {
    uint256 userId;
    bytes32 hNomeOficial;
    bytes32 hNomeMuculmano;
    bytes32 hMesquita;
    string  uri;
    bool    exists;
}

struct Credential {
    uint256         id;
    CredentialType  credType;  // Enum!
    address         issuer;
    address         subject;
    bytes32         claimHash;
    string          uri;
    uint256         issuedAt;
    bool            revoked;
}
```

**Como usar:**
```solidity
// Criar uma struct
Profile memory novoProfile = Profile({
    userId: 1,
    hNomeOficial: 0xabc...,
    hNomeMuculmano: 0xdef...,
    hMesquita: 0x123...,
    uri: "",
    exists: true
});

// Acessar campos
uint256 id = novoProfile.userId;
bool existe = novoProfile.exists;
```

**Diferença entre `memory` e `storage`:**
- `storage` → dados gravados permanentemente na blockchain (variáveis de estado)
- `memory` → dados temporários, existem só durante a execução da função (como RAM)

```solidity
// Referência ao storage (modifica o dado na blockchain)
Profile storage p = _profiles[user];
p.exists = true; // modifica diretamente na blockchain!

// Cópia em memória (não modifica o original)
Profile memory p = _profiles[user];
p.exists = true; // modifica apenas a cópia local
```

---

## 11 — Mappings

Mapping é a estrutura de dados mais importante do Solidity. É como um **dicionário** (hash map) que associa uma chave a um valor.

```solidity
// address → Profile
mapping(address => Profile) private _profiles;

// uint256 → Credential
mapping(uint256 => Credential) private _credentials;

// address → lista de IDs
mapping(address => uint256[]) private _userCredentials;

// address → bool (flag)
mapping(address => bool) private _isSheikh;
```

**Como usar:**
```solidity
// Escrever
_profiles[msg.sender] = Profile({ ... });

// Ler
Profile storage p = _profiles[userAddress];
uint256 id = p.userId;

// Verificar existência (mapping NUNCA dá erro; retorna valor padrão)
bool existe = _profiles[userAddress].exists; // false se nunca foi escrito
```

**Características importantes:**
- Mappings **não são iteráveis** — você não pode "listar todas as chaves"
- Se você acessar uma chave inexistente, recebe o **valor padrão** do tipo (0, false, address(0), etc.)
- Por isso o IslamicPassport mantém um array `_sheikhs` separado para poder listar

---

## 12 — Arrays

Arrays armazenam listas de elementos do mesmo tipo.

```solidity
// Array dinâmico (tamanho variável)
address[] private _sheikhs;
uint256[] private _userCredentials;

// Array fixo (tamanho definido)
uint256[10] private fixo; // sempre 10 elementos
```

**Operações:**
```solidity
// Adicionar elemento
_sheikhs.push(novoEndereco);

// Acessar por índice (0-based)
address primeiro = _sheikhs[0];

// Tamanho
uint256 total = _sheikhs.length;

// Retornar array inteiro (em funções view)
function listSheikhs() external view returns (address[] memory) {
    return _sheikhs;
}
```

**No IslamicPassport**, usamos arrays para:
- `_sheikhs` → lista de endereços de sheiks (para iteração)
- `_userCredentials[user]` → IDs das credenciais de cada usuário

---

## 13 — Events (Eventos)

Eventos são **logs** gravados na blockchain. São baratos (muito mais que storage) e servem para:
- Notificar aplicações externas (a UI) sobre o que aconteceu
- Criar um histórico consultável
- Indexar dados para buscas eficientes

```solidity
// Declaração
event ProfileRegistered(
    address indexed user,       // indexed = buscável
    uint256 indexed userId,
    bytes32 hNomeOficial,
    bytes32 hNomeMuculmano,
    bytes32 hMesquita,
    string  uri
);

event CredentialRevoked(
    uint256 indexed credentialId,
    address indexed revokedBy
);
```

**Como emitir:**
```solidity
emit ProfileRegistered(msg.sender, userId, hNome, hMuslim, hMosque, uri);
emit CredentialRevoked(credentialId, msg.sender);
```

**`indexed`:**
- Até 3 parâmetros podem ser `indexed`
- Parâmetros indexed podem ser **filtrados** nas buscas (ex: "me mostre todos os eventos onde user = 0x123...")
- A UI em JavaScript pode escutar eventos em tempo real:

```javascript
contract.on("ProfileRegistered", (user, userId, ...) => {
    console.log(`Novo registro: ${user} com userId ${userId}`);
});
```

---

## 14 — Modifiers (Modificadores)

Modificadores são **"guards"** que adicionam verificações antes (ou depois) de uma função executar.

O OpenZeppelin `AccessControl` nos dá o modificador `onlyRole`:

```solidity
// Uso do modifier — SOMENTE quem tem SHEIK_ROLE pode chamar
function attestMuslim(
    address subject,
    bytes32 claimHash,
    string calldata optionalUri
) external onlyRole(SHEIK_ROLE) {   // ← modifier aqui!
    // ... código só executa se msg.sender tiver SHEIK_ROLE
}
```

**Como criar seu próprio modifier:**
```solidity
modifier apenasRegistrado() {
    require(_profiles[msg.sender].exists, "Nao registrado");
    _; // ← este underscore significa "execute o corpo da função aqui"
}

function minhaFuncao() external apenasRegistrado {
    // Só executa se msg.sender estiver registrado
}
```

O `_;` dentro do modifier indica **onde o corpo da função original será inserido**.

---

## 15 — Constructor (Construtor)

O construtor é uma função especial executada **uma única vez**, no momento do deploy.

```solidity
constructor() {
    // Deployer recebe DEFAULT_ADMIN_ROLE
    _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);

    // Captura chainId para gerar DID
    deployChainId = block.chainid;
}
```

**Características:**
- Executado apenas 1 vez (no deploy)
- Pode receber parâmetros (ex: `constructor(address admin)`)
- Ideal para configuração inicial (definir admin, gravar chainId, etc.)
- `msg.sender` no construtor é quem fez o deploy

**Analogia:** o construtor é como o `__init__` do Python ou o `constructor` do JavaScript — inicializa o estado do objeto.

---

## 16 — Functions (Funções)

Funções são a lógica executável do contrato.

### Anatomia de uma função

```solidity
function nomeDaFuncao(
    TipoParametro nomeParam     // parâmetros de entrada
)
    external                     // visibilidade
    onlyRole(SHEIK_ROLE)        // modifier (opcional)
    returns (uint256)           // tipo de retorno (opcional)
{
    // corpo da função
    return 42;
}
```

### Tipos de função por efeito

| Keyword | Lê estado? | Modifica estado? | Custa gas? |
|---------|-----------|-----------------|-----------|
| (nenhum) | Sim | Sim | Sim (transação) |
| `view` | Sim | Não | Não* |
| `pure` | Não | Não | Não* |

*Quando chamadas externamente (não dentro de uma transação).

```solidity
// view — lê dados mas não modifica nada
function getProfile(address user) external view returns (...) {
    Profile storage p = _profiles[user];
    return (p.userId, p.hNomeOficial, ...);
}

// pure — não lê nem modifica estado, só faz cálculos
function _uint2str(uint256 value) internal pure returns (string memory) {
    // converte número para string — cálculo puro
}

// (sem keyword) — modifica estado, custa gas
function registerProfile(...) external {
    _profiles[msg.sender] = Profile({ ... }); // escreve no storage
}
```

### `calldata` vs `memory` em parâmetros

```solidity
// calldata — mais barato, dados são somente-leitura (não podem ser modificados)
function registro(string calldata uri) external { ... }

// memory — cópia modificável dos dados
function interno(string memory uri) internal { ... }
```

**Regra prática:**
- Parâmetros de funções `external` → use `calldata` (mais barato)
- Parâmetros de funções `internal`/`public` → use `memory`
- Variáveis locais de tipos complexos → use `memory`

---

## 17 — Require e Revert

Solidity usa `require` para validar condições. Se a condição for falsa, a transação é **revertida** (todo o efeito é desfeito) e o gas restante é devolvido.

```solidity
function registerProfile(...) external {
    // Se já registrou, reverte com mensagem de erro
    require(!_profiles[msg.sender].exists, "IslamicPassport: perfil ja registrado");

    // ... resto da lógica (só executa se o require passou)
}

function attestMuslim(address subject, ...) external onlyRole(SHEIK_ROLE) {
    require(_profiles[subject].exists, "IslamicPassport: subject nao registrado");
    // ...
}

function revokeCredential(uint256 credentialId) external {
    Credential storage cred = _credentials[credentialId];
    require(cred.id != 0, "IslamicPassport: credencial inexistente");
    require(!cred.revoked, "IslamicPassport: credencial ja revogada");
    require(
        cred.issuer == msg.sender || hasRole(DEFAULT_ADMIN_ROLE, msg.sender),
        "IslamicPassport: sem permissao para revogar"
    );
    // ...
}
```

**Alternativas ao `require`:**

```solidity
// revert — reverte incondicionalmente (usado com if)
if (saldo < valor) {
    revert("Saldo insuficiente");
}

// Custom errors (Solidity ≥0.8.4) — mais eficiente em gas
error SaldoInsuficiente(uint256 disponivel, uint256 necessario);

if (saldo < valor) {
    revert SaldoInsuficiente(saldo, valor);
}

// assert — para invariantes que NUNCA devem falhar (bugs)
assert(totalUsers > 0); // se falhar, é um bug no código
```

| Função | Quando usar |
|--------|------------|
| `require` | Validar input do usuário, verificar permissões |
| `revert` | Quando a lógica de verificação é complexa |
| `assert` | Verificar invariantes internas (não devem falhar nunca) |

---

## 18 — Variáveis globais

Solidity fornece variáveis globais acessíveis em qualquer função:

### `msg` — informações sobre a chamada atual

| Variável | Tipo | Descrição |
|----------|------|-----------|
| `msg.sender` | `address` | Quem chamou a função (usuário ou contrato) |
| `msg.value` | `uint256` | Quantidade de ETH enviada na chamada (em wei) |
| `msg.data` | `bytes` | Dados brutos da chamada |

### `block` — informações sobre o bloco atual

| Variável | Tipo | Descrição |
|----------|------|-----------|
| `block.timestamp` | `uint256` | Timestamp Unix do bloco (em segundos) |
| `block.number` | `uint256` | Número do bloco |
| `block.chainid` | `uint256` | ID da chain (1=Mainnet, 11155111=Sepolia) |

### `address(this)` — o próprio contrato

```solidity
address enderecoDoContrato = address(this);
```

**No IslamicPassport:**
```solidity
constructor() {
    _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);  // msg.sender = quem fez deploy
    deployChainId = block.chainid;                // chainId no momento do deploy
}

function registerProfile(...) external {
    // msg.sender = quem está registrando
    _profiles[msg.sender] = Profile({ ... });

    // address(this) = o contrato é o issuer do certificado inicial
    _issueCredential(CredentialType.INITIAL, address(this), msg.sender, ...);
}

// block.timestamp = quando a credencial foi emitida
_credentials[credId] = Credential({
    issuedAt: block.timestamp,
    ...
});
```

---

## 19 — Herança e AccessControl

O **AccessControl** do OpenZeppelin implementa um sistema de **papéis** (roles). Cada papel é identificado por um `bytes32`.

### Como funciona

```solidity
// Definir um papel
bytes32 public constant SHEIK_ROLE = keccak256("SHEIK_ROLE");
// DEFAULT_ADMIN_ROLE já vem definido no AccessControl = 0x00

// No construtor: dar papel ao deployer
constructor() {
    _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
}

// Proteger uma função com onlyRole
function attestMuslim(...) external onlyRole(SHEIK_ROLE) {
    // Só quem tem SHEIK_ROLE pode chamar
}

// Dar/remover papéis programaticamente
_grantRole(SHEIK_ROLE, novoSheik);    // dar papel
_revokeRole(SHEIK_ROLE, exSheik);     // remover papel

// Verificar papel
bool ehSheik = hasRole(SHEIK_ROLE, endereco);
```

### Hierarquia de papéis

Por padrão, `DEFAULT_ADMIN_ROLE` é o "admin" de todos os outros papéis, podendo conceder e revogar qualquer papel. No IslamicPassport:

```
DEFAULT_ADMIN_ROLE (deployer)
    └── pode gerenciar SHEIK_ROLE
    └── pode revogar qualquer credencial

SHEIK_ROLE (concedido ao 1º registrado ou por outro sheik)
    └── pode atestar muçulmanos
    └── pode promover outros a sheik
```

---

## 20 — Gas e otimização

**Gas** é a unidade de custo computacional no Ethereum. Cada operação tem um custo:

| Operação | Custo aproximado |
|----------|-----------------|
| Criar variável no storage (SSTORE novo) | ~20.000 gas |
| Modificar variável no storage (SSTORE existente) | ~5.000 gas |
| Ler do storage (SLOAD) | ~2.100 gas |
| Emitir evento (LOG) | ~375 + 375×topics |
| Operação aritmética | ~3-5 gas |
| Chamada de função | ~700+ gas |

### Dicas de otimização usadas no IslamicPassport

1. **`bytes32` em vez de `string` para hashes** — tamanho fixo é muito mais barato

2. **Armazenar apenas hashes on-chain** — strings longas de dados pessoais custariam muito gas

3. **Usar `calldata` para parâmetros de funções `external`** — evita cópia para memória

4. **Eventos para dados que não precisam ser consultados pelo contrato** — 8x mais barato que storage

5. **Array + mapping para listagem** — mapping para acesso O(1), array para iteração:
   ```solidity
   address[] private _sheikhs;              // para listar
   mapping(address => bool) private _isSheikh; // para verificar O(1)
   ```

---

## 21 — Resumo visual

```
┌─────────────────────────────────────────────────────────────┐
│                    CONTRATO SOLIDITY                         │
│                                                              │
│  ┌──── pragma solidity ^0.8.20 ────┐                        │
│  │  Define a versão do compilador   │                        │
│  └─────────────────────────────────┘                        │
│                                                              │
│  ┌──── import ─────────────────────┐                        │
│  │  Traz código externo            │                        │
│  │  (OpenZeppelin, etc.)           │                        │
│  └─────────────────────────────────┘                        │
│                                                              │
│  ┌──── contract MeuContrato is ... ────────────────────┐    │
│  │                                                      │    │
│  │  ESTADO (variáveis na blockchain):                   │    │
│  │  ├─ uint256, address, bool        (tipos primitivos) │    │
│  │  ├─ bytes32 constant ROLE         (constantes)       │    │
│  │  ├─ enum CredentialType           (enumerações)      │    │
│  │  ├─ struct Profile, Credential    (estruturas)       │    │
│  │  ├─ mapping(address => Profile)   (dicionários)      │    │
│  │  └─ address[] sheikhs             (arrays)           │    │
│  │                                                      │    │
│  │  EVENTOS (logs na blockchain):                       │    │
│  │  ├─ event ProfileRegistered(...)                     │    │
│  │  ├─ event CredentialIssued(...)                      │    │
│  │  └─ event CredentialRevoked(...)                     │    │
│  │                                                      │    │
│  │  CONSTRUTOR (executa 1x no deploy):                  │    │
│  │  └─ constructor() { ... }                            │    │
│  │                                                      │    │
│  │  FUNÇÕES PÚBLICAS (API do contrato):                 │    │
│  │  ├─ registerProfile()    external                    │    │
│  │  ├─ attestMuslim()       external onlyRole(SHEIK)    │    │
│  │  ├─ promoteToSheikh()    external onlyRole(SHEIK)    │    │
│  │  ├─ revokeCredential()   external                    │    │
│  │  ├─ getDID()             external view               │    │
│  │  ├─ getProfile()         external view               │    │
│  │  ├─ listSheikhs()        external view               │    │
│  │  └─ isSheikh()           external view               │    │
│  │                                                      │    │
│  │  FUNÇÕES INTERNAS (auxiliares):                      │    │
│  │  ├─ _issueCredential()   internal                    │    │
│  │  ├─ _addSheikh()         internal                    │    │
│  │  ├─ _uint2str()          internal pure               │    │
│  │  └─ _addr2str()          internal pure               │    │
│  │                                                      │    │
│  └──────────────────────────────────────────────────────┘    │
│                                                              │
│  VISIBILIDADE:                                               │
│  public    → todos veem                                      │
│  external  → só chamadas de fora                             │
│  internal  → contrato + filhos                               │
│  private   → só o contrato                                   │
│                                                              │
│  MODIFICADORES DE FUNÇÃO:                                    │
│  view      → só lê (grátis)                                  │
│  pure      → não lê nem escreve (grátis)                     │
│  payable   → pode receber ETH                                │
│                                                              │
│  LOCALIZAÇÃO DE DADOS:                                       │
│  storage   → blockchain permanente (caro)                    │
│  memory    → RAM temporária (barato)                         │
│  calldata  → dados de entrada somente-leitura (mais barato)  │
└─────────────────────────────────────────────────────────────┘
```

---

## Referências para aprofundamento

- **Documentação oficial:** https://docs.soliditylang.org/
- **OpenZeppelin Contracts:** https://docs.openzeppelin.com/contracts/
- **Remix IDE:** https://remix.ethereum.org/
- **Solidity by Example:** https://solidity-by-example.org/
- **CryptoZombies (tutorial interativo):** https://cryptozombies.io/
- **Ethereum.org Learn:** https://ethereum.org/pt-br/developers/docs/smart-contracts/languages/
