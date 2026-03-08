# Scripts de Deploy - Islamic Passport

Este diretório contém os scripts necessários para fazer o deploy do sistema Islamic Passport no Remix IDE.

## 📁 Scripts Disponíveis

### 1. `deploy_islamic_passport.js`
**Deploy completo sem migração**

- ✅ Deploy do `IslamicPassportCertificates`
- ✅ Deploy do `IslamicPrayerRegistry` 
- ✅ Deploy do `IslamicPassport` (fachada principal)
- ✅ Verificação automática das integrações
- ✅ Logs detalhados com emojis

**Quando usar:**
- Primeiro deploy em nova rede
- Deploy em ambiente de teste
- Quando não há contrato legado para migrar

### 2. `deploy_islamic_passport_with_migration.js`
**Deploy com migração de contrato legado**

- ✅ Deploy dos subcontratos
- ✅ Deploy do `IslamicPassport` com migração
- ✅ Migração automática de dados do legado
- ✅ Preservação de usuários e credenciais

**Quando usar:**
- Atualização de contrato existente
- Migração de versão anterior
- Preservação de dados existentes

**⚠️ Configuração necessária:**
```javascript
const LEGACY_CONTRACT_ADDRESS = "0x..."; // Insira o endereço aqui
```

### 3. `verify_deployment.js`
**Verificação pós-deploy**

- ✅ Verificação de integridade do contrato
- ✅ Teste de integrações
- ✅ Verificação de permissões
- ✅ Validação de chain ID

**Quando usar:**
- Após qualquer deploy
- Para troubleshooting
- Para confirmar funcionamento

**⚠️ Configuração necessária:**
```javascript
const ISLAMIC_PASSPORT_ADDRESS = "0x..."; // Insira o endereço aqui
```

## 🚀 Como Usar

### Pré-requisitos
1. **Compilar todos os contratos** no Remix IDE
2. **Configurar o environment** (Remix VM ou Injected Provider)
3. **Conectar a carteira** (se usando Injected Provider)

### Passos para Deploy

1. **Abrir o Remix IDE**
2. **Navegar para a aba "Plugins"**
3. **Ativar "Remix Scripting"** (se ainda não estiver ativo)
4. **Abrir o script desejado** em `scripts/`
5. **Configurar variáveis** (se necessário)
6. **Executar o script** clicando no botão ▶

### Exemplo de Execução

```bash
# No Remix IDE:
# 1. Abra o arquivo scripts/deploy_islamic_passport.js
# 2. Clique no botão ▶ (Run)
# 3. Aguarde a conclusão do deploy
# 4. Copie o endereço do contrato principal
```

## 📋 Estrutura dos Contratos

```
IslamicPassport (Fachada Principal)
├── IslamicPassportCertificates (Gestor de Credenciais)
└── IslamicPrayerRegistry (Registro de Orações)
```

### Ordem de Deploy
1. **IslamicPassportCertificates** - Gerencia todas as credenciais
2. **IslamicPrayerRegistry** - Gerencia locais de oração e sheiks
3. **IslamicPassport** - Fachada principal que integra os outros

## 🔍 Verificação Pós-Deploy

Após o deploy, sempre execute o `verify_deployment.js` para:

- ✅ Confirmar que todos os contratos estão funcionando
- ✅ Verificar integrações entre contratos
- ✅ Testar permissões do deployer
- ✅ Validar chain ID correto

## 🐛 Troubleshooting

### Erros Comuns

**"Contract not found"**
- Verifique se compilou todos os contratos
- Confirme que os arquivos JSON existem em `contracts/artifacts/`

**"Insufficient funds"**
- Verifique o saldo da carteira
- Confirme o gas limit está adequado

**"Network mismatch"**
- Verifique se está na rede correta
- Confirme o chain ID no deploy

### Dicas

- **Use Remix VM** para testes rápidos
- **Salve os endereços** após cada deploy
- **Execute sempre a verificação** pós-deploy
- **Mantenha backup** dos endereços dos contratos

## 📝 Logs e Emojis

Os scripts usam emojis para melhor visualização:

- 🚀 Início do processo
- 📜 Certificados
- 🕌 Registro de orações  
- 🪪 Passport principal
- ✅ Sucesso
- ❌ Erro
- ⚠️ Aviso
- 🔍 Verificação
- 🔗 Integrações

## 🔄 Migração vs Deploy Novo

| Característica | Deploy Novo | Com Migração |
|---------------|-------------|-------------|
| Usuários | 0 | Mantidos |
| Credenciais | 0 | Mantidas |
| Sheiks | 0 | Mantidos |
| Configuração | Limpa | Preservada |
| Tempo | Rápido | Mais lento |

## 📞 Suporte

Em caso de dúvidas:

1. Verifique os logs detalhados do script
2. Execute o script de verificação
3. Confirme a configuração da rede
4. Verifique o saldo da carteira
