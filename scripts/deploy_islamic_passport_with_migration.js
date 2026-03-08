/**
 * @file deploy_islamic_passport_with_migration.js
 * @description Script de deploy do IslamicPassport com migração de contrato legado para uso no Remix IDE.
 *              Execute via o plugin "Remix Scripting" (botão ▶ no editor).
 *
 * Pré-requisitos:
 *   - Todos os contratos compilados no Remix.
 *   - Environment configurado (Remix VM ou Injected Provider).
 *   - Endereço do contrato legado existente.
 *
 * Ordem de deploy:
 *   1. IslamicPassportCertificates (gestor de credenciais)
 *   2. IslamicPrayerRegistry (registro de orações)
 *   3. IslamicPassport (fachad a principal) com migração
 */

(async () => {
  try {
    console.log("🚀 Iniciando deploy com migração do IslamicPassport...");
    console.log("=" .repeat(60));

    // Configuração do endereço legado (modifique conforme necessário)
    const LEGACY_CERTIFICATES_ADDRESS = "0X..."; // <-- INSIRA O ENDEREÇO DO CONTRATO LEGADO AQUI
    const LEGACY_PRAYER_REGISTRY_ADDRESS = "0X..."; // <-- INSIRA O ENDEREÇO DO CONTRATO LEGADO AQUI
    const LEGACY_CONTRACT_ADDRESS = "0x..."; // <-- INSIRA O ENDEREÇO DO CONTRATO LEGADO AQUI
    
    if (LEGACY_CONTRACT_ADDRESS === "0x..." || LEGACY_CERTIFICATES_ADDRESS === "0X..." || LEGACY_PRAYER_REGISTRY_ADDRESS === "0X...") {
      console.warn("⚠️ ATENÇÃO: Configure o endereço do contrato legado nas variáveis LEGACY_CONTRACT_ADDRESS, LEGACY_CERTIFICATES_ADDRESS e LEGACY_PRAYER_REGISTRY_ADDRESS");
      console.warn("   Ou use o script deploy_islamic_passport.js para deploy sem migração");
      return;
    }

    console.log("📋 Endereço do contrato de certificados legado:", LEGACY_CERTIFICATES_ADDRESS);
    console.log("📋 Endereço do contrato de orações legado:", LEGACY_PRAYER_REGISTRY_ADDRESS);
    console.log("📋 Endereço do contrato legado:", LEGACY_CONTRACT_ADDRESS);

    // 1. Deploy do IslamicPassportCertificates
    console.log("\n📜 [1/3] Deploy do IslamicPassportCertificates...");
    
    const certificatesMetadata = JSON.parse(
      await remix.call(
        "fileManager",
        "getFile",
        "contracts/artifacts/IslamicPassportCertificates.json"
      )
    );

    const certificatesFactory = new ethers.ContractFactory(
      certificatesMetadata.abi,
      certificatesMetadata.data.bytecode.object
    );

    const certificatesContract = await certificatesFactory.deploy(LEGACY_CERTIFICATES_ADDRESS);
    const certificatesReceipt = await certificatesContract.deploymentTransaction().wait();

    console.log("✅ IslamicPassportCertificates implantado!");
    console.log("   Endereço:", certificatesContract.target);
    console.log("   Tx hash:", certificatesReceipt.hash);
    console.log("   Block:", certificatesReceipt.blockNumber);

    // 2. Deploy do IslamicPrayerRegistry
    console.log("\n🕌 [2/3] Deploy do IslamicPrayerRegistry...");
    
    const prayerRegistryMetadata = JSON.parse(
      await remix.call(
        "fileManager",
        "getFile",
        "contracts/artifacts/IslamicPrayerRegistry.json"
      )
    );

    const prayerRegistryFactory = new ethers.ContractFactory(
      prayerRegistryMetadata.abi,
      prayerRegistryMetadata.data.bytecode.object
    );

    const prayerRegistryContract = await prayerRegistryFactory.deploy(LEGACY_PRAYER_REGISTRY_ADDRESS);
    const prayerRegistryReceipt = await prayerRegistryContract.deploymentTransaction().wait();

    console.log("✅ IslamicPrayerRegistry implantado!");
    console.log("   Endereço:", prayerRegistryContract.target);
    console.log("   Tx hash:", prayerRegistryReceipt.hash);
    console.log("   Block:", prayerRegistryReceipt.blockNumber);

    // 3. Deploy do IslamicPassport com migração
    console.log("\n🪪 [3/3] Deploy do IslamicPassport com migração...");
    
    const passportMetadata = JSON.parse(
      await remix.call(
        "fileManager",
        "getFile",
        "contracts/artifacts/IslamicPassport.json"
      )
    );

    const passportFactory = new ethers.ContractFactory(
      passportMetadata.abi,
      passportMetadata.data.bytecode.object
    );

    // Deploy com endereços dos subcontratos e migração do legado
    const passportContract = await passportFactory.deploy(
      LEGACY_CONTRACT_ADDRESS, // legacyAddress (endereço do contrato antigo)
      certificatesContract.target, // certificatesAddress
      prayerRegistryContract.target // prayerRegistryAddress
    );
    
    const passportReceipt = await passportContract.deploymentTransaction().wait();

    console.log("✅ IslamicPassport implantado com migração!");
    console.log("   Endereço:", passportContract.target);
    console.log("   Tx hash:", passportReceipt.hash);
    console.log("   Block:", passportReceipt.blockNumber);

    // Verificação da migração
    console.log("\n🔍 Verificando migração...");
    const legacyAddress = await passportContract.legacyContract();
    const deployChainId = await passportContract.deployChainId();
    
    console.log("🔗 Endereço do legado configurado:", legacyAddress);
    console.log("🔗 Chain ID do deploy:", deployChainId.toString());

    // Resumo completo
    console.log("\n" + "=".repeat(60));
    console.log("🎉 DEPLOY COM MIGRAÇÃO REALIZADO COM SUCESSO!");
    console.log("=".repeat(60));
    console.log("📋 Endereços dos contratos:");
    console.log("   📜 IslamicPassportCertificates:", certificatesContract.target);
    console.log("   🕌 IslamicPrayerRegistry:", prayerRegistryContract.target);
    console.log("   🪪 IslamicPassport (fachada):", passportContract.target);
    console.log("   🔄 Contrato Legado migrado:", LEGACY_CONTRACT_ADDRESS);
    console.log("\n💡 Use o endereço do IslamicPassport na UI:");
    console.log("   Copie e cole no campo 'Contrato' da interface.");
    console.log("=" .repeat(60));

    // Verificação das integrações
    console.log("\n🔍 Verificando integrações...");
    
    const certAddress = await passportContract.certificates();
    const registryAddress = await passportContract.prayerRegistry();
    
    console.log("🔗 Integração com Certificates:", certAddress === certificatesContract.target ? "✅ OK" : "❌ ERRO");
    console.log("🔗 Integração com PrayerRegistry:", registryAddress === prayerRegistryContract.target ? "✅ OK" : "❌ ERRO");
    console.log("🔗 Migração do legado:", legacyAddress === LEGACY_CONTRACT_ADDRESS ? "✅ OK" : "❌ ERRO");

  } catch (err) {
    console.error("❌ Erro no deploy:", err.message || err);
    console.error("📍 Stack trace:", err.stack);
  }
})();
