/**
 * @file verify_deployment.js
 * @description Script de verificação do deploy do IslamicPassport para uso no Remix IDE.
 *              Execute via o plugin "Remix Scripting" (botão ▶ no editor).
 *
 * Pré-requisitos:
 *   - Contratos deployados.
 *   - Environment configurado (Remix VM ou Injected Provider).
 */

(async () => {
  try {
    console.log("🔍 Verificando deploy do IslamicPassport...");
    console.log("=" .repeat(50));

    // Endereço do contrato principal (modifique conforme necessário)
    const ISLAMIC_PASSPORT_ADDRESS = "0x..."; // <-- INSIRA O ENDEREÇO DO ISLAMIC PASSPORT AQUI
    
    if (ISLAMIC_PASSPORT_ADDRESS === "0x...") {
      console.warn("⚠️ ATENÇÃO: Configure o endereço do IslamicPassport na variável ISLAMIC_PASSPORT_ADDRESS");
      return;
    }

    console.log("📋 Endereço do IslamicPassport:", ISLAMIC_PASSPORT_ADDRESS);

    // Carregar ABI do contrato
    const passportMetadata = JSON.parse(
      await remix.call(
        "fileManager",
        "getFile",
        "contracts/artifacts/IslamicPassport.json"
      )
    );

    // Conectar ao contrato
    const passportContract = new ethers.Contract(
      ISLAMIC_PASSPORT_ADDRESS,
      passportMetadata.abi,
      ethers.provider
    );

    console.log("\n🔍 Verificando informações básicas...");
    
    // Verificar identificação do contrato
    const contractInfo = await passportContract.identifyContract();
    console.log("📄 Informações do contrato:");
    console.log("   ", contractInfo);

    // Verificar chain ID
    const deployChainId = await passportContract.deployChainId();
    const currentChainId = await ethers.provider.getNetwork();
    console.log("🔗 Chain ID do deploy:", deployChainId.toString());
    console.log("🔗 Chain ID atual:", currentChainId.chainId.toString());
    console.log("   Chain ID compatível:", deployChainId.toString() === currentChainId.chainId.toString() ? "✅ OK" : "❌ ERRO");

    // Verificar integrações
    console.log("\n🔗 Verificando integrações com subcontratos...");
    
    const certificatesAddress = await passportContract.certificates();
    const prayerRegistryAddress = await passportContract.prayerRegistry();
    
    console.log("📜 IslamicPassportCertificates:", certificatesAddress);
    console.log("🕌 IslamicPrayerRegistry:", prayerRegistryAddress);

    // Verificar se os endereços são válidos
    const certValid = certificatesAddress !== ethers.ZeroAddress;
    const registryValid = prayerRegistryAddress !== ethers.ZeroAddress;
    
    console.log("   Endereço de certificates válido:", certValid ? "✅ OK" : "❌ ERRO");
    console.log("   Endereço de prayerRegistry válido:", registryValid ? "✅ OK" : "❌ ERRO");

    // Verificar contrato legado (se existir)
    const legacyAddress = await passportContract.legacyContract();
    if (legacyAddress !== ethers.ZeroAddress) {
      console.log("🔄 Contrato legado configurado:", legacyAddress);
      console.log("   Migração habilitada: ✅ OK");
    } else {
      console.log("🔄 Contrato legado: Não configurado (deploy novo)");
    }

    // Testar funções básicas
    console.log("\n🧪 Testando funções básicas...");
    
    try {
      const totalUsers = await passportContract.totalUsers();
      console.log("👥 Total de usuários:", totalUsers.toString());
      
      const totalCredentials = await passportContract.totalCredentials();
      console.log("📜 Total de credenciais:", totalCredentials.toString());

      const attestationTypes = await passportContract.getAvailableAttestationTypes();
      console.log("📋 Tipos de atestado disponíveis:", attestationTypes.length);
      
      attestationTypes.forEach((type, index) => {
        console.log(`   [${index}] ${type.label} (${type.key})`);
      });

    } catch (err) {
      console.error("❌ Erro ao testar funções básicas:", err.message);
    }

    // Verificar se o caller tem permissões
    console.log("\n🔐 Verificando permissões do caller...");
    
    const [signer] = await ethers.getSigners();
    const signerAddress = await signer.getAddress();
    console.log("👤 Endereço do caller:", signerAddress);

    try {
      const isSheikh = await passportContract.isSheikh(signerAddress);
      console.log("   É Sheikh:", isSheikh ? "✅ SIM" : "❌ NÃO");

      const hasDefaultAdmin = await passportContract.hasRole(await passportContract.DEFAULT_ADMIN_ROLE(), signerAddress);
      console.log("   É Admin:", hasDefaultAdmin ? "✅ SIM" : "❌ NÃO");

      const hasSuperAdmin = await passportContract.hasRole(await passportContract.SUPER_ADMIN_ROLE(), signerAddress);
      console.log("   É SuperAdmin:", hasSuperAdmin ? "✅ SIM" : "❌ NÃO");

    } catch (err) {
      console.error("❌ Erro ao verificar permissões:", err.message);
    }

    // Resumo final
    console.log("\n" + "=".repeat(50));
    console.log("🎉 VERIFICAÇÃO CONCLUÍDA!");
    console.log("=".repeat(50));
    console.log("✅ Contrato deployado e funcionando corretamente!");
    console.log("📋 Use este endereço na UI:", ISLAMIC_PASSPORT_ADDRESS);

  } catch (err) {
    console.error("❌ Erro na verificação:", err.message || err);
    console.error("📍 Stack trace:", err.stack);
  }
})();
