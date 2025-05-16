
Script para consumir API do SIAET e salvar AETs localmente

- Esse é um script para o download de arquivos JSON de uma api
- Insina no .env o secret e o id em base 64
- Escolha o ano que deseja baixar no .env
- Na linha 12 "./aetsbaixadas"; é o nome da pasta onde sera baixado, se ela não existir o script ira criar.
- O download sera feito dentro do diretorio do script
- O script ira criar toda a estrutura de ano/mes.

Crie o arquivo .env

SIAET_ID_BASE64= insira o id em base64
SIAET_SECRET_BASE64= insira o secret em base64
ANO_CONSULTA=2024 insira o ano
#MES_ESPECIFICO= deixe comentado para baixar o ano todo, ou insira um mes especifico