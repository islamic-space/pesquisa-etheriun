/**
 * @file app-locations.js
 * @description Funções específicas para gestão de locais de oração, admin e doações
 */

// ═══════════════════════════════════════════════════════════
//  Funções auxiliares para locais
// ═══════════════════════════════════════════════════════════

/**
 * Popula o select de ordens sufis
 */
function populateSufiOrders() {
  const select = document.getElementById('locSufiOrder');
  if (!select) return;

  select.innerHTML = '';
  SUFI_ORDERS.forEach(order => {
    const option = document.createElement('option');
    option.value = order.key;
    option.textContent = order.label;
    select.appendChild(option);
  });
}

/**
 * Atualiza a tabela de locais
 */
async function refreshLocations() {
  const tbody = document.getElementById('locationsTableBody');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="6" style="color:var(--text-secondary);">Carregando...</td></tr>';

  try {
    const locationIds = await contract.listPrayerLocationIds();
    const rows = await Promise.all(locationIds.map(async (id) => {
      const location = await contract.getPrayerLocation(id);
      const sheikhs = location.sheikhs || [];
      const memberCount = location.memberCount || 0;
      
      return `
        <tr>
          <td>${id}</td>
          <td>${location.core.name}</td>
          <td>${LOCATION_TYPE_LABELS[location.core.locationType] || 'Outro'}</td>
          <td>${sheikhs.length}</td>
          <td>${memberCount}</td>
          <td>
            <button class="btn btn-sm" onclick="viewLocationDetails(${id})">Ver</button>
            <button class="btn btn-sm btn-danger" onclick="removeLocation(${id})">Remover</button>
          </td>
        </tr>
      `;
    }));

    tbody.innerHTML = rows.join('');
  } catch (error) {
    console.error('❌ Erro ao carregar locais:', error);
    tbody.innerHTML = '<tr><td colspan="6" style="color:var(--text-error);">Erro ao carregar locais</td></tr>';
  }
}

/**
 * Manipula a criação/atualização de local
 */
async function handleLocationCreate(e) {
  e.preventDefault();
  if (!contract) {
    showStatus('Conecte a carteira primeiro', 'error');
    return;
  }

  const name = document.getElementById('locName').value.trim();
  const type = parseInt(document.getElementById('locType').value);
  const geo = document.getElementById('locGeo').value.trim();
  const sufiOrder = document.getElementById('locSufiOrder').value;
  const sufiFriendly = document.getElementById('locSufiFriendly').checked;

  if (!name) {
    showStatus('Nome do local é obrigatório', 'error');
    return;
  }

  try {
    showStatus('Enviando transação...', 'info');

    const locationInput = {
      name,
      locationType: type,
      geoReference: geo,
      sufiFriendly,
      sufiOrder
    };

    const payload = {
      createNewLocation: true,
      existingLocationId: 0,
      locationInput
    };

    const tx = await contract.managePrayerLocation(payload);
    showStatus('Transação enviada. Aguardando confirmação...', 'info');
    
    await tx.wait();
    showStatus('Local criado com sucesso! 🕌', 'success');
    
    // Limpar formulário
    e.target.reset();
    
    // Atualizar lista
    await refreshLocations();
  } catch (error) {
    console.error('❌ Erro ao criar local:', error);
    showStatus('Erro ao criar local: ' + (error.reason || error.message), 'error');
  }
}

/**
 * Manipula a associação de sheikh a local
 */
async function handleAssignSheikh(e) {
  e.preventDefault();
  if (!contract) {
    showStatus('Conecte a carteira primeiro', 'error');
    return;
  }

  const sheikhAddr = document.getElementById('assignSheikhAddr').value.trim();
  const locationId = parseInt(document.getElementById('assignLocationId').value);

  if (!sheikhAddr || !locationId) {
    showStatus('Preencha todos os campos', 'error');
    return;
  }

  try {
    showStatus('Associando sheikh ao local...', 'info');

    const locationInput = {
      name: '',
      locationType: 0,
      geoReference: '',
      sufiFriendly: false,
      sufiOrder: ''
    };

    const payload = {
      createNewLocation: false,
      existingLocationId: locationId,
      locationInput
    };

    const tx = await contract.assignSheikhToLocation(sheikhAddr, payload);
    showStatus('Transação enviada. Aguardando confirmação...', 'info');
    
    await tx.wait();
    showStatus('Sheikh associado com sucesso! 🤝', 'success');
    
    // Limpar formulário
    e.target.reset();
    
    // Atualizar lista
    await refreshLocations();
  } catch (error) {
    console.error('❌ Erro ao associar sheikh:', error);
    showStatus('Erro ao associar sheikh: ' + (error.reason || error.message), 'error');
  }
}

// ═══════════════════════════════════════════════════════════
//  Funções de Admin
// ═══════════════════════════════════════════════════════════

/**
 * Manipula a promoção de sheikh
 */
async function handlePromoteSheikh(e) {
  e.preventDefault();
  if (!contract) {
    showStatus('Conecte a carteira primeiro', 'error');
    return;
  }

  const subject = document.getElementById('promoteSubject').value.trim();
  const claimHash = document.getElementById('promoteClaimHash').value.trim() || '0x';
  const uri = document.getElementById('promoteUri').value.trim();
  const locationId = parseInt(document.getElementById('promoteLocationId').value) || 0;

  if (!subject) {
    showStatus('Endereço do sheikh é obrigatório', 'error');
    return;
  }

  try {
    showStatus('Promovendo a sheikh...', 'info');

    const tx = await contract.promoteToSheikh(subject, claimHash, uri);
    showStatus('Transação enviada. Aguardando confirmação...', 'info');
    
    await tx.wait();
    showStatus('Sheikh promovido com sucesso! 🌟', 'success');
    
    // Se houver local, associar
    if (locationId > 0) {
      try {
        const locationInput = {
          name: '',
          locationType: 0,
          geoReference: '',
          sufiFriendly: false,
          sufiOrder: ''
        };

        const payload = {
          createNewLocation: false,
          existingLocationId: locationId,
          locationInput
        };

        await contract.assignSheikhToLocation(subject, payload);
        showStatus('Sheikh associado ao local com sucesso! 🕌', 'success');
      } catch (assocError) {
        console.warn('⚠️ Sheik promovido mas não associado ao local:', assocError);
      }
    }
    
    // Limpar formulário
    e.target.reset();
    
    // Atualizar listas
    await refreshSheikhs();
    await refreshLocations();
  } catch (error) {
    console.error('❌ Erro ao promover sheikh:', error);
    showStatus('Erro ao promover sheikh: ' + (error.reason || error.message), 'error');
  }
}

/**
 * Manipula a emissão de certificado sufi
 */
async function handleIssueSufi(e) {
  e.preventDefault();
  if (!contract) {
    showStatus('Conecte a carteira primeiro', 'error');
    return;
  }

  const subject = document.getElementById('sufiSubject').value.trim();
  const claimHash = document.getElementById('sufiClaimHash').value.trim();
  const uri = document.getElementById('sufiUri').value.trim();

  if (!subject || !claimHash) {
    showStatus('Preencha os campos obrigatórios', 'error');
    return;
  }

  try {
    showStatus('Emitindo certificado sufi...', 'info');

    const tx = await contract.issueSufiCertificate(subject, claimHash, uri);
    showStatus('Transação enviada. Aguardando confirmação...', 'info');
    
    await tx.wait();
    showStatus('Certificado sufi emitido com sucesso! 🎭', 'success');
    
    // Limpar formulário
    e.target.reset();
  } catch (error) {
    console.error('❌ Erro ao emitir certificado sufi:', error);
    showStatus('Erro ao emitir certificado sufi: ' + (error.reason || error.message), 'error');
  }
}

/**
 * Manipula a transferência de sheikh entre locais
 */
async function handleTransferSheikh(e) {
  e.preventDefault();
  if (!contract) {
    showStatus('Conecte a carteira primeiro', 'error');
    return;
  }

  const sheikhAddr = document.getElementById('transferSheikhAddr').value.trim();
  const targetLocationId = parseInt(document.getElementById('transferTargetLocationId').value);

  if (!sheikhAddr || !targetLocationId) {
    showStatus('Preencha todos os campos', 'error');
    return;
  }

  try {
    showStatus('Transferindo sheikh...', 'info');

    const tx = await contract.transferSheikhToLocation(sheikhAddr, targetLocationId);
    showStatus('Transação enviada. Aguardando confirmação...', 'info');
    
    await tx.wait();
    showStatus('Sheikh transferido com sucesso! 🔄', 'success');
    
    // Limpar formulário
    e.target.reset();
    
    // Atualizar lista
    await refreshLocations();
  } catch (error) {
    console.error('❌ Erro ao transferir sheikh:', error);
    showStatus('Erro ao transferir sheikh: ' + (error.reason || error.message), 'error');
  }
}

/**
 * Manipula a remoção de sheikh de local
 */
async function handleRemoveSheikhFromLocation(e) {
  e.preventDefault();
  if (!contract) {
    showStatus('Conecte a carteira primeiro', 'error');
    return;
  }

  const sheikhAddr = document.getElementById('removeSheikhAddr').value.trim();

  if (!sheikhAddr) {
    showStatus('Endereço do sheikh é obrigatório', 'error');
    return;
  }

  try {
    showStatus('Removendo sheikh do local...', 'info');

    const tx = await contract.removeSheikhFromLocation(sheikhAddr);
    showStatus('Transação enviada. Aguardando confirmação...', 'info');
    
    await tx.wait();
    showStatus('Sheikh removido do local com sucesso! ✖️', 'success');
    
    // Limpar formulário
    e.target.reset();
    
    // Atualizar lista
    await refreshLocations();
  } catch (error) {
    console.error('❌ Erro ao remover sheikh:', error);
    showStatus('Erro ao remover sheikh: ' + (error.reason || error.message), 'error');
  }
}

// ═══════════════════════════════════════════════════════════
//  Funções de Doações
// ═══════════════════════════════════════════════════════════

/**
 * Atualiza a tabela de doações do usuário
 */
async function refreshDonations() {
  const tbody = document.getElementById('donationsTableBody');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="5" style="color:var(--text-secondary);">Carregando...</td></tr>';

  try {
    // TODO: Implementar função para buscar doações do usuário
    // Por enquanto, mostra mensagem padrão
    tbody.innerHTML = '<tr><td colspan="5" style="color:var(--text-secondary);">Nenhuma doação registrada.</td></tr>';
  } catch (error) {
    console.error('❌ Erro ao carregar doações:', error);
    tbody.innerHTML = '<tr><td colspan="5" style="color:var(--text-error);">Erro ao carregar doações</td></tr>';
  }
}

/**
 * Manipula o envio de doações
 */
async function handleDonate(e) {
  e.preventDefault();
  if (!contract) {
    showStatus('Conecte a carteira primeiro', 'error');
    return;
  }

  const amount = parseFloat(document.getElementById('donateAmount').value);
  const beneficiaryType = parseInt(document.getElementById('donateBeneficiaryType').value);
  const locationId = parseInt(document.getElementById('donateLocationId').value) || 0;
  const beneficiaryAddr = document.getElementById('donateBeneficiaryAddr').value.trim();
  const note = document.getElementById('donateNote').value.trim();
  const uri = document.getElementById('donateUri').value.trim();

  if (!amount || amount <= 0) {
    showStatus('Valor da doação é obrigatório', 'error');
    return;
  }

  if (beneficiaryType === 0 && !locationId) {
    showStatus('ID do local é obrigatório para doações a mesquitas', 'error');
    return;
  }

  if (beneficiaryType === 1 && !beneficiaryAddr) {
    showStatus('Endereço do beneficiário é obrigatório', 'error');
    return;
  }

  try {
    showStatus('Processando doação...', 'info');

    const payload = {
      amount: ethers.parseEther(amount.toString()),
      beneficiaryType,
      locationId,
      beneficiaryAddress: beneficiaryAddr || '0x'
    };

    const claimHash = ethers.keccak256(ethers.toUtf8Bytes(note || 'Donation'));
    
    const tx = await contract.donateZakatOrSadaqah(payload, note, claimHash, uri, {
      value: payload.amount
    });
    
    showStatus('Transação enviada. Aguardando confirmação...', 'info');
    
    await tx.wait();
    showStatus('Doação realizada com sucesso! 💝', 'success');
    
    // Limpar formulário
    e.target.reset();
    
    // Atualizar lista
    await refreshDonations();
  } catch (error) {
    console.error('❌ Erro ao processar doação:', error);
    showStatus('Erro ao processar doação: ' + (error.reason || error.message), 'error');
  }
}

// ═══════════════════════════════════════════════════════════
//  Funções utilitárias
// ═══════════════════════════════════════════════════════════

/**
 * Exibe detalhes de um local
 */
function viewLocationDetails(locationId) {
  // TODO: Implementar modal com detalhes do local
  console.log('🕌 Ver detalhes do local:', locationId);
  showStatus('Funcionalidade em desenvolvimento', 'info');
}

/**
 * Remove um local
 */
async function removeLocation(locationId) {
  if (!confirm('Tem certeza que deseja remover este local?')) return;
  
  // TODO: Implementar remoção de local
  console.log('🗑️ Remover local:', locationId);
  showStatus('Funcionalidade em desenvolvimento', 'info');
}
