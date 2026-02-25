/**
 * @file deploy_islamic_passport.js
 * @description Script de deploy do IslamicPassport para uso no Remix IDE.
 *              Execute via o plugin "Remix Scripting" (botão ▶ no editor).
 *
 * Pré-requisitos:
 *   - Contrato IslamicPassport.sol compilado no Remix.
 *   - Environment configurado (Remix VM ou Injected Provider).
 */

(async () => {
  try {
    console.log("Iniciando deploy do IslamicPassport...");

    const metadata = JSON.parse(
      await remix.call(
        "fileManager",
        "getFile",
        "contracts/artifacts/IslamicPassport.json"
      )
    );

    const factory = new ethers.ContractFactory(
      metadata.abi,
      metadata.data.bytecode.object
    );

    const contract = await factory.deploy();
    const receipt = await contract.deploymentTransaction().wait();

    console.log("=".repeat(50));
    console.log("IslamicPassport implantado com sucesso!");
    console.log("Endereço do contrato:", contract.target);
    console.log("Tx hash:", receipt.hash);
    console.log("Block:", receipt.blockNumber);
    console.log("=".repeat(50));
    console.log(
      "\nCopie o endereço acima e cole no campo 'Contrato' da UI."
    );
  } catch (err) {
    console.error("Erro no deploy:", err.message || err);
  }
})();
