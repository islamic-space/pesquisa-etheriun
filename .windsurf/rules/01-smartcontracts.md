---
trigger: model_decision
---

Ao criar SmartContracts, use a linguagem Solidity, insira um cabeçalho com os dados dos autores, sendo atualmente Carlos Delfino, E-mail consultoria@carlosdelfino.eti.br Ether Address 0x841B788FFcbAdFabc5E8A2CfcBbeC93179B9ABef e Solana DMpnSvYmUfjrEkc5ZaFFEJTqKhyoATcAHBGgWZzucf9j.

O Contrato deverá ter ao menos a função que identifica o contrato, ao ser chamada deve retornar um json com os seguintes dados:
* Nome do Contrato
* Versão do Contrato
* Data do Deploy
* Lista dos autores do contrato, com seus e-mails e endereços de redes cripto.

Esta função deve ser usada para identificar se o contrato é pertencente a lista de constratos da aplicação, que deverá escanear a blockchain em até 20000 contratos retroativamente até encontrar o primeiro contrato.

Toda Applicação deve ser capaz de encontrar o contrato e exibir ao usuário que está sendo selecionado o contrato conforme os metadados obtidos.