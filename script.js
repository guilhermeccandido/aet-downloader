require("dotenv").config();
const axios = require("axios");
const fs = require("fs").promises;
const path = require("path");

const SIAET_ID = process.env.SIAET_ID;
const SIAET_SECRET = process.env.SIAET_SECRET;
const ANO_CONSULTA = process.env.ANO_CONSULTA;

const MAX_TENTATIVAS = 3;
const BASE_DIR = "./aetsbaixadas";


async function obterToken(id, secret) {
  if (!id || !secret) {
    console.error("ID ou SECRET não fornecidos preencher no .env");
    throw new Error("credenciais não fornecidas");
  }
  //const idBase64 = Buffer.from(id).toString("base64");
  //const secretBase64 = Buffer.from(secret).toString("base64");
  const idBase64 = id;
  const secretBase64 = secret;

  const url = `https://siaet.dnit.gov.br/api/token/?Id=${idBase64}&Secret=${secretBase64}`;

  console.log("Solicitando token");
  try {
    const response = await axios.get(url);
    if (
      response.data &&
      response.data.siaet &&
      response.data.siaet.retorno === "token" &&
      response.data.siaet.codigo === "200"
    ) {
      console.log("Token obtido");
      return response.data.siaet.mensagem;
    } else {
      const erroMsg = response.data.siaet
        ? `${response.data.siaet.codigo}: ${response.data.siaet.mensagem}`
        : "resposta idenperada da api do token";
      console.error("Erro ao obter token:", erroMsg);
      throw new Error(`Falha ao obter token: ${erroMsg}`);
    }
  } catch (error) {
    console.error("erro de requisição do token:", error.message);
    if (error.response && error.response.data && error.response.data.siaet) {
      console.error(
        "detalhes do erro da api:",
        error.response.data.siaet.mensagem,
      );
      throw new Error(`Falha na api: ${error.response.data.siaet.mensagem}`);
    } else if (error.response) {
      console.error("detalhes do erro da api:", error.response.data);
    }
    throw error;
  }
}

async function consultarAET(token, mes, ano) {
  const mesFormatado = mes.toString().padStart(2, "0");
  const url = `https://siaet.dnit.gov.br/api/aet/detalhe/v1/?token=${token}&mesLiberacaoAet=${mesFormatado}&anoLiberacaoAet=${ano}`;
  console.log(`consultando aet para ${mesFormatado}/${ano}`);

  for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
    try {
      const response = await axios.get(url);
      if (
        response.data &&
        response.data.AET &&
        Array.isArray(response.data.AET)
      ) {
        if (response.data.AET.length > 0) {
          console.log(
            `Dados AET (${response.data.AET.length} registros) recebidos com sucesso para ${mesFormatado}/${ano}.`,
          );
        } else {
          console.log(`Nenhuma AET encontrada para ${mesFormatado}/${ano}.`);
        }
        return response.data; //retorna os dados mesmo coma aet vazia
      } else if (
        response.data &&
        response.data.siaet &&
        response.data.siaet.retorno === "erro"
      ) {
        console.warn(`Erro da API (${response.data.siaet.codigo}): ${response.data.siaet.mensagem}`);

        if (
          response.data.siaet.mensagem === "token invalido" ||
          response.data.siaet.mensagem === "token expirado"
        ) {
          console.log("token invalido ou expirado.");
          throw new Error("token invalido ou expirado");
        }
        if (
          tentativa === MAX_TENTATIVAS ||
          response.data.siaet.codigo === "400.005"
        ) {
          console.error(
            "fala ao obter as aets, nao havera mais tentativas para esse mes",
          );
          return null;
        }
      } else {
        console.warn("sem aets validas");
      }
      if (tentativa < MAX_TENTATIVAS) {
        console.log("AGUARDE PARA TENTAR DE NOVO");
      } else {
        console.error("falha ao obter as aets não havera mais tentativas");
        return null;
      }
    } catch (error) {
      console.error("falha na tentativa de obter asaets:", error.message);
      if (error.response) {
      console.error("Status HTTP:", error.response.status);
      console.error("Resposta da API:", error.response.data);
      }
;
      if (error.message === "token invalido") {
        throw error;
      }
      if (tentativa === MAX_TENTATIVAS) {
        console.error("Erro final ao consultar aets");
        return null;
      }
      console.log("aguardando 5 segundo para tentar novamente");
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
  return null;
}

async function salvarDados(dados, ano, mes) {
  const mesFormatado = mes.toString().padStart(2, "0");
  const dirPath = path.join(BASE_DIR, ano.toString(), mesFormatado);
  const filePath = path.join(dirPath, `aet_${ano}_${mesFormatado}.json`);
  try {
    await fs.mkdir(dirPath, { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(dados, null, 2));
    console.log(`Dados salvos em ${filePath}`);
  } catch (error) {
    console.error("Erro ao salvar o arquivo atual");
  }
}

async function main() {
  console.log(`Iniciando processo de download das AETs`);

  if (!SIAET_ID || !SIAET_SECRET) {
    console.error("SIAET_ID e SIAET_SECRET não foram fornecidos");
    return;
  }

  let token;
  for (let mes = 1; mes <= 12; mes++) {
    const mesFormatado = mes.toString().padStart(2, "0");
    console.log(`\n---processando o mês ${mesFormatado}/${ANO_CONSULTA}---`);
    try {
      console.log("obtendo token do mes atual");
      token = await obterToken(SIAET_ID, SIAET_SECRET);
      if (!token) {
        console.error(
          `nao foi possivel obter token do mes ${mesFormatado}/${ANO_CONSULTA}. pulando esse mes`,
        );
        continue;
      }

      const dadosAET = await consultarAET(token, mes, ANO_CONSULTA);

      if (dadosAET) {
        await salvarDados(dadosAET, ANO_CONSULTA, mes);
      } else {
        console.warn(
          `nenhum dado de aet foi retornado ou houve falha persistente para ${mesFormatado}/${ANO_CONSULTA}.`,
        );
      }
    } catch (error) {
      if (error.message === "token invalido") {
        console.warn(
          `token explirou para o mes ${mesFormatado}/${ANO_CONSULTA}.`,
        );
        if (error.stack) {
          console.error(error.stack);
        }
      }
    }

    console.log("2s para processar o proximo mes");
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}
  main().catch((error) => {
    console.error("erro no script", error.message);
    if (error.stack) {
      console.error(error.stack);
    }
  });

