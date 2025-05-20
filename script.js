require('dotenv').config();
const { chromium } = require('playwright');
const fs = require('fs').promises;
const path = require('path');

const SIAET_ID_BASE64 = process.env.SIAET_ID_BASE64;
const SIAET_SECRET_BASE64 = process.env.SIAET_SECRET_BASE64;
const ANO_CONSULTA = process.env.ANO_CONSULTA;
const MES_ESPECIFICO = process.env.MES_ESPECIFICO;
const PLAYWRIGHT_NAVIGATION_TIMEOUT = parseInt(process.env.PLAYWRIGHT_NAVIGATION_TIMEOUT || '1200000', 10);

const BASE_DIR = './aetsbaixadas';

async function horaIniciar(hora, minutos = 0) {
  const agora = new Date();
  const alvo = new Date();

  alvo.setHours(hora, minutos, 0, 0);

  if (alvo <= agora) {
    alvo.setDate(alvo.getDate() + 1);
  }

  const msAteAlvo = alvo - agora;
  console.log(`Aguardando até ${alvo.toLocaleTimeString()} para iniciar o script...`);

  return new Promise(resolve => setTimeout(resolve, msAteAlvo));
}

async function obterToken(browser, idBase64, secretBase64) {
  if (!idBase64 || !secretBase64) {
    console.error('ID ou SECRET (Base64) não fornecidos. Verifique o arquivo .env');
    throw new Error('Credenciais (Base64) não fornecidas');
  }

  const tokenUrl = `https://siaet.dnit.gov.br/api/token/?Id=${idBase64}&Secret=${secretBase64}`;
  console.log('Solicitando token:', tokenUrl);

  const page = await browser.newPage();
  try {
    await page.goto(tokenUrl, { timeout: 60000 });
    const content = await page.textContent('body');
    const jsonData = JSON.parse(content);

    if (jsonData && jsonData.siaet && jsonData.siaet.retorno === 'token' && jsonData.siaet.codigo === '200') {
      const tokenValue = jsonData.siaet.mensagem;
      console.log('Token obtido:', tokenValue);
      return tokenValue;
    } else {
      const erroMsg = jsonData.siaet ? `${jsonData.siaet.codigo}: ${jsonData.siaet.mensagem}` : 'Resposta inesperada da API de token';
      console.error('Erro ao obter token:', erroMsg);
      throw new Error(`Falha ao obter token: ${erroMsg}`);
    }
  } catch (error) {
    console.error('Erro na requisição do token:', error.message);
    throw error;
  } finally {
    await page.close();
  }
}

async function consultarAET(browser, token, mes, ano) {
  const mesFormatado = mes.toString().padStart(2, '0');
  const aetUrl = `https://siaet.dnit.gov.br/api/aet/detalhe/v1/?token=${encodeURIComponent(token)}&mesLiberacaoAet=${mesFormatado}&anoLiberacaoAet=${ano}`;
  console.log(`Consultando AETs para ${mesFormatado}/${ano} (Timeout: ${PLAYWRIGHT_NAVIGATION_TIMEOUT / 1000}s):`, aetUrl);

  const page = await browser.newPage();
  try {
    page.setDefaultNavigationTimeout(PLAYWRIGHT_NAVIGATION_TIMEOUT);
    page.setDefaultTimeout(PLAYWRIGHT_NAVIGATION_TIMEOUT);

    await page.goto(aetUrl, { waitUntil: 'networkidle', timeout: PLAYWRIGHT_NAVIGATION_TIMEOUT });

    let jsonText = await page.locator('body pre').textContent({ timeout: 5000 }).catch(() => null);
    if (!jsonText) {
      jsonText = await page.locator('body').textContent();
    }

    if (!jsonText || jsonText.trim() === '') {
      console.warn(`Nenhum conteúdo JSON encontrado na página para ${mesFormatado}/${ano}.`);
      return null;
    }

    try {
      const jsonData = JSON.parse(jsonText);
      console.log(`Dados AET recebidos com sucesso para ${mesFormatado}/${ano}.`);
      return jsonData;
    } catch (parseError) {
      console.error(`Erro ao fazer parse do JSON para ${mesFormatado}/${ano}:`, parseError.message);
      console.error("Conteúdo recebido que falhou no parse:", jsonText.substring(0, 500) + "...");
      return null;
    }

  } catch (error) {
    console.error(`Erro ao consultar AETs para ${mesFormatado}/${ano}:`, error.message);
    if (error.name === 'TimeoutError') {
      console.error(`A consulta para ${mesFormatado}/${ano} excedeu o timeout de ${PLAYWRIGHT_NAVIGATION_TIMEOUT / 1000}s.`);
    }
    return null;
  } finally {
    await page.close();
  }
}

async function salvarDados(dados, ano, mes) {
  const mesFormatado = mes.toString().padStart(2, '0');
  const dirPath = path.join(BASE_DIR, ano.toString(), mesFormatado);
  const filePath = path.join(dirPath, `aet_${ano}_${mesFormatado}.json`);
  try {
    await fs.mkdir(dirPath, { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(dados, null, 2));
    console.log(`Dados salvos em ${filePath}`);
  } catch (error) {
    console.error('Erro ao salvar o arquivo:', error.message);
  }
}

async function main() {
  console.log(`Iniciando processo de download das AETs para o ano ${ANO_CONSULTA}.`);
  console.log(`Timeout para navegação e consulta de AETs configurado para: ${PLAYWRIGHT_NAVIGATION_TIMEOUT / 1000} segundos.`);

  if (!SIAET_ID_BASE64 || !SIAET_SECRET_BASE64) {
    console.error('SIAET_ID_BASE64 e SIAET_SECRET_BASE64 não foram fornecidos no .env');
    return;
  }
  if (!ANO_CONSULTA) {
    console.error('ERRO CRÍTICO: A variável ANO_CONSULTA não está definida no arquivo .env.');
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    ignoreHTTPSErrors: true
  });

  try {
    let mesesParaProcessar = [];

    if (MES_ESPECIFICO) {
      const mesesSeparados = MES_ESPECIFICO.split(';')
        .map(m => parseInt(m.trim()))
        .filter(m => m >= 1 && m <= 12);

      if (mesesSeparados.length > 0) {
        mesesParaProcessar = mesesSeparados;
        console.log(`Processando meses específicos: ${mesesParaProcessar.join(', ')}/${ANO_CONSULTA}`);
      } else {
        console.warn('MES_ESPECIFICO fornecido está vazio ou inválido. Processando todos os meses.');
        mesesParaProcessar = Array.from({ length: 12 }, (_, i) => i + 1);
      }
    } else {
      console.log('Nenhum mês específico definido. Processando todos os meses de 1 a 12.');
      mesesParaProcessar = Array.from({ length: 12 }, (_, i) => i + 1);
    }

    for (const mes of mesesParaProcessar) {
      const mesFormatado = mes.toString().padStart(2, '0');
      console.log(`\n--- Processando o mês ${mesFormatado}/${ANO_CONSULTA} ---`);

      const token = await obterToken(context, SIAET_ID_BASE64, SIAET_SECRET_BASE64);
      if (!token) {
        console.error(`Falha ao obter token para o mês ${mesFormatado}/${ANO_CONSULTA}. Pulando...`);
        continue;
      }

      const dadosAET = await consultarAET(context, token, mes, ANO_CONSULTA);

      if (dadosAET) {
        if (dadosAET.AET && Array.isArray(dadosAET.AET) && dadosAET.AET.length > 0) {
          await salvarDados(dadosAET, ANO_CONSULTA, mes);
        } else if (dadosAET.siaet && dadosAET.siaet.retorno === 'erro') {
          console.warn(`API retornou erro para ${mesFormatado}/${ANO_CONSULTA}: ${dadosAET.siaet.codigo} - ${dadosAET.siaet.mensagem}. Nenhum arquivo será salvo.`);
        } else {
          console.warn(`Nenhuma AET encontrada ou estrutura de dados inesperada para ${mesFormatado}/${ANO_CONSULTA}. Nenhum arquivo será salvo.`);
        }
      } else {
        console.warn(`Nenhum dado de AET foi retornado para ${mesFormatado}/${ANO_CONSULTA}. Nenhum arquivo será salvo.`);
      }

      console.log('Aguardando 2 segundos antes de processar o próximo mês...');
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

  } catch (error) {
    console.error('Erro principal no script:', error.message);
  } finally {
    await browser.close();
    console.log('\nProcesso de download de AETs concluído.');
  }
}

(async () => {
  await horaIniciar(23, 0);
  await main(); 
})();
