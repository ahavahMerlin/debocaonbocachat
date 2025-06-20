// Importa as bibliotecas necessárias
const qrcode = require('qrcode-terminal');
const { Client, LocalAuth } = require('whatsapp-web.js');
const fs = require('fs-extra');
const express = require('express');
const app = express();
const port = process.env.PORT || 5000;
const DATA_FILE = 'data.json';
const path = require('path');
//const rimraf = require('rimraf'); // Importa a biblioteca rimraf

// Configuração das Variáveis de Ambiente (Use .env file)
require('dotenv').config();

// ==== Configuração de Variáveis de Ambiente e Configuração Inicial ====
const CONFIG_FILE = 'config.json';
let configData = {
    CLIENT_ID: process.env.CLIENT_ID || 'botLocal1',
    BOT_NUMBER: process.env.BOT_NUMBER || '5512997507961',
    TRIGGER_WORD: process.env.TRIGGER_WORD || 'oi',
    installDate: null
};

// Carregar ou inicializar a configuração
if (fs.existsSync(CONFIG_FILE)) {
    try {
        const savedData = fs.readJsonSync(CONFIG_FILE);
        configData = { ...configData, ...savedData };

        const installDate = new Date(savedData.installDate);
        const today = new Date();
        const diffDays = Math.floor((today - installDate) / (1000 * 60 * 60 * 24));

        if (diffDays >= 365) {
            // Licença expirada - Redefinir valores
            configData.CLIENT_ID = '';
            configData.BOT_NUMBER = '5511111111111';
            configData.TRIGGER_WORD = '*';
            console.log('⚠️ LICENÇA EXPIRADA: Variáveis redefinidas automaticamente.');
        }
    } catch (error) {
        console.error("Erro ao ler o arquivo config.json. Usando valores padrão.", error);
        // Se houver um erro ao ler o arquivo, redefina os valores para os padrões para evitar falhas
        configData.CLIENT_ID = 'botLocal1';
        configData.BOT_NUMBER = '5512997507961';
        configData.TRIGGER_WORD = 'oi';
    }
} else {
    // Primeira execução - Grava a data atual
    configData.installDate = new Date().toISOString();
    fs.writeJsonSync(CONFIG_FILE, configData, { spaces: 2 });
    console.log('📅 Primeira execução registrada.');
}

// Persistir a configuração atualizada
try {
    fs.writeJsonSync(CONFIG_FILE, configData, { spaces: 2 });
} catch (error) {
    console.error("Erro ao gravar no arquivo config.json.", error);
}

// Definir variáveis a partir da configuração
const CLIENT_ID = configData.CLIENT_ID;
const BOT_NUMBER = configData.BOT_NUMBER;
const TRIGGER_WORD = configData.TRIGGER_WORD;

// Log das variáveis de ambiente para debugging
console.log('CLIENT_ID:', CLIENT_ID);
console.log('BOT_NUMBER:', BOT_NUMBER);
console.log('TRIGGER_WORD:', TRIGGER_WORD);

const botNumber = BOT_NUMBER;

if (!botNumber) {
    console.error("Erro: A variável de ambiente BOT_NUMBER não está definida.");
}

// --- Constantes de Reconexão ---
const MAX_RETRIES = 5;
const INITIAL_RETRY_DELAY = 5000; // 5 segundos

// Função para limpar a pasta de sessão
async function clearSession(clientId) {
    const sessionPath = path.join(__dirname, '.wwebjs_auth', `session-${clientId}`);
    const debugLogPath = path.join(sessionPath, 'Default', 'chrome_debug.log');  // Caminho para o arquivo

    console.log(`clearSession: Verificando a pasta de sessão: ${sessionPath}`);

    if (fs.existsSync(sessionPath)) {
        console.log(`clearSession: A pasta de sessão existe. Excluindo...`);

        // Tenta apagar o arquivo chrome_debug.log primeiro
        if (fs.existsSync(debugLogPath)) {
            console.log(`clearSession: Tentando apagar o arquivo chrome_debug.log...`);
            try {
                await fs.unlink(debugLogPath); // Use fs.unlink para remover o arquivo
                console.log(`clearSession: Arquivo chrome_debug.log apagado com sucesso.`);
            } catch (unlinkErr) {
                console.error(`clearSession: Erro ao apagar o arquivo chrome_debug.log:`, unlinkErr);
                console.log(`clearSession: Tentando continuar apagando a pasta mesmo assim...`);
                // Não interrompe o processo se falhar ao apagar o log. Tenta apagar a pasta.
            }
        }

        try {
            // Usa a função rimraf para remover a pasta
            rimraf(sessionPath, (err) => {
                if (err) {
                    console.error(`clearSession: Erro ao excluir pasta com rimraf (callback):`, err);
                    try {
                        fs.remove(sessionPath);
                        console.log(`clearSession: Pasta de sessão excluída com sucesso com fs-extra.`);
                    } catch (fsErr) {
                        console.error(`clearSession: Erro ao excluir pasta com fs-extra:`, fsErr);
                        console.log(`clearSession: Não foi possível limpar a pasta de sessão, continuando...`);
                    }
                } else {
                    console.log(`clearSession: Pasta de sessão excluída com sucesso com rimraf.`);
                }
            });
            return;
        } catch (err) {
            console.error(`clearSession: Erro ao excluir pasta com rimraf (try/catch):`, err);
            try {
                await fs.remove(sessionPath);
                console.log(`clearSession: Pasta de sessão excluída com sucesso com fs-extra.`);
            } catch (fsErr) {
                console.error(`clearSession: Erro ao excluir pasta com fs-extra:`, fsErr);
                console.log(`clearSession: Não foi possível limpar a pasta de sessão, continuando...`);
            }
        }
    } else {
        console.log(`clearSession: A pasta de sessão não existe.`);
    }
}

// ---------------------- Funções Utilitárias ----------------------
// Carrega os dados do arquivo JSON
async function loadData() {
    try {
        const data = await fs.readJson(DATA_FILE);
        return data;
    } catch (err) {
        console.warn(`Erro ao carregar os dados (pode ser a primeira execução ou arquivo vazio):`, err.message);
        if (err.code === 'ENOENT') {
            console.log(`Arquivo não encontrado, criando um novo...`);
            await fs.writeJson(DATA_FILE, [], { spaces: 2 });
            return [];
        } else if (err instanceof SyntaxError) {
            console.log(`Arquivo corrompido ou vazio, criando um novo...`);
            await fs.writeJson(DATA_FILE, [], { spaces: 2 });
            return [];
        } else {
            console.error(`Erro ao carregar/criar arquivo de dados:`, err);
            return [];
        }
    }
}

// Salva os dados no arquivo JSON
async function saveData(data) {
    try {
        await fs.writeJson(DATA_FILE, data, { spaces: 2 });
    } catch (err) {
        console.error(`Erro ao salvar os dados:`, err);
    }
}

// Função de delay (para simular digitação)
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------------------- Inicialização do Cliente WhatsApp ----------------------

let client;  // Declare client outside initializeClient so reconnectWithBackoff can access it
let qrCodeData; // Variável para armazenar os dados do QR code.
let isInitializing = false; // Flag para evitar múltiplas inicializações simultâneas
let isReady = false; // Flag para verificar se o cliente está pronto

// Função para inicializar o cliente com tratamento de erro
async function initializeClient() {
    if (isInitializing) {
        console.log("Já está em processo de inicialização. Ignorando chamada.");
        return;
    }

    isInitializing = true; // Define a flag como true para indicar que a inicialização está em andamento
    const startTime = Date.now();  // Marca o tempo de início

    try {
        console.log(`initializeClient: Inicializando o cliente...`);

        client = new Client({
            authStrategy: new LocalAuth({ clientId: CLIENT_ID }),
            puppeteer: {
                headless: true, // Altere para false para debugging
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-cache',
                    '--disable-application-cache',
                    '--disable-offline-load-stale-cache',
                    '--disk-cache-size=0',
                    '--disable-gpu',           // Desativa a aceleração de hardware (útil em alguns ambientes)
                    '--disable-extensions'    // Desativa extensões (pode melhorar a performance)
                ],
                timeout: 90000,
            },
            // Adicionado para tentar resolver problemas de contexto
            restartOnAuthFail: true,
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        });

        client.on('qr', qr => {
            console.log(`Evento QR Code disparado.`);
            qrCodeData = qr; // Armazena os dados do QR code.
            qrcode.generate(qr, { small: true });

            // Gera a URL do QR Code para que o usuário possa escanear com o celular
            const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=256x256&data=${encodeURIComponent(qr)}`;
            console.log('QR Code URL:', qrCodeUrl); // Exibe a URL no console
        });

        client.on('ready', () => {
            console.log(`Tudo certo! WhatsApp conectado.`);
            retryCount = 0; // Reseta o contador de tentativas
            isInitializing = false; // Define a flag como false após a inicialização bem-sucedida
            isReady = true; // Define a flag como true quando o cliente está pronto

            // Aguarda 5 segundos antes de iniciar o keep-alive
            setTimeout(() => {
                console.log(`Iniciando rotina de Keep-Alive...`);
                // Keep-Alive
                setInterval(async () => {
                    if (isReady) {  // Verifica se o cliente está pronto antes de enviar a mensagem
                        try {
                            //Formata o número do bot para o formato correto do wid
                            //const botWid = client.getNumberId(BOT_NUMBER); // Use getNumberId instead of getWid

                            // Verificar se o número existe antes de enviar a mensagem
                            try {
                                const numberId = await client.getNumberId(BOT_NUMBER);
                                if (numberId) {
                                    await client.sendMessage(numberId._serialized, 'Keep-alive');
                                    console.log(`Keep-alive message sent.`);
                                } else {
                                    console.warn(`Número do bot não encontrado.`);
                                }
                            } catch (error) {
                                console.error(`Erro ao obter número do bot ou enviar keep-alive:`, error);
                            }
                        } catch (error) {
                            console.error(`Erro ao enviar keep-alive:`, error);
                            isReady = false;  // Se houver um erro, define o cliente como não pronto
                        }
                    } else {
                        console.warn("Cliente não está pronto, pulando keep-alive.");
                    }
                }, 300000); // A cada 5 minutos
            }, 5000);
        });

        client.on('disconnected', (reason) => {
            console.warn(`WhatsApp desconectado: ${reason}`);
            console.warn(`Motivo da desconexão: ${reason}`);
            isReady = false; // Define o cliente como não pronto
            //console.log(`${new Date().toISOString()} - Client Info:`, client.info);
            reconnectWithBackoff(); // Chama a função de reconexão com backoff
        });

        client.on('auth_failure', reason => {
            console.error(`Falha na autenticação: ${reason}`);
            isReady = false; // Define o cliente como não pronto
            // Tente reconectar ou tomar outras medidas apropriadas aqui
            reconnectWithBackoff();

        });

        client.on('message', async msg => {
             if (!isReady) {
                console.warn("Cliente não está pronto, ignorando mensagem.");
                return;
            }

            try {
                const inicioProcessamento = Date.now();

                // Verifica se a mensagem corresponde aos critérios do menu
                if (msg.body.match(new RegExp(`(${TRIGGER_WORD}|menu|Menu|dia|tarde|noite|Oi|Olá|olá|Ola)`, 'i')) && msg.from.endsWith('@c.us')) {
                    console.log(`Mensagem corresponde aos critérios, iniciando processamento...`);

                    const chat = await msg.getChat();
                    console.log(`Chat obtido.`);

                    await delay(500);
                    await chat.sendStateTyping();
                    await delay(500);

                    const contact = await msg.getContact();
                    console.log(`Informações do contato obtidas.`);

                    const name = contact.pushname || 'Cliente';
                    console.log(`Nome do contato: ${name}`);

                    // Envia a mensagem de boas-vindas formatada
                    await client.sendMessage(msg.from, `Olá! ${name.split(" ")[0]},\n\nSou Ana Clara represento a empresa DeBocaEmBoca. Você é o número 16 na fila, como posso ajudá-lo(a) hoje?\n\nNão deixe de visitar e se inscrever em nosso Canal Youtube (https://www.youtube.com/@debocaemboca2025/videos?sub_confirmation=1)\n\nE seguir nosso Instagram (https://www.instagram.com/debocaemboca2025/)\n\nPor favor, digite o *número* da opção desejada abaixo:\n\n1 - Ter um(a) Assistente Virtual Humanizado que atende seus clientes e qualifica LEADS com captação a partir de R$ 1.500,00 ou ter os templates e arquivos de configurações prontos, mais nosso suporte remote pelo AnyDesk\n\n2 - Tenha 3 consultas mensais por pequena assinatura mensal, que vão otimizar seu negócio usando Soluções com Inteligência Artificial,\nEm diversas áreas\nEm CiberSegurança Famíliar, pequenas e Médias Empresas\nEm Marketing Digital\nEm Desenvolvimento de Aplicativos Mobile\n\n3 - Pequeno Dossiê; Médio ou Completo sobre quem lhe prejudicou, deu golpe ou quem de você desconfia ou por assinatura mensal R$ 150,00, com direito a 3 consultas mensais - Cada consulta adicional, R$ 100,00\n\n4 - Quer divulgação personalizada como esta, entre em contato\n\n5 - Outras perguntas`);

                    console.log(`Mensagem de boas-vindas enviada.`);

                    await delay(500);
                    await chat.sendStateTyping();
                    await delay(500);

                    // Cria objeto com dados do usuário
                    const userData = {
                        whatsapp: msg.from.replace('@c.us', ''),
                        nome: name,
                        email: null,
                        opcoes_escolhidas: []
                    };

                    // Carrega os dados existentes
                    let existingData = await loadData();
                    existingData = Array.isArray(existingData) ? existingData : [];

                    // Adiciona os novos dados
                    existingData.push(userData);

                    // Salva os dados atualizados
                    await saveData(existingData);
                }
                // Verifica se a mensagem é uma opção válida (1 a 5)
                else if (['1', '2', '3', '4', '5'].includes(msg.body) && msg.from.endsWith('@c.us')) {
                    // Chama a função para lidar com a opção
                    await handleOption(msg.body, msg, client);
                }

                const fimProcessamento = Date.now();
                const tempoTotal = (fimProcessamento - inicioProcessamento) / 1000;
                console.log(`Tempo total de processamento da mensagem: ${tempoTotal} segundos.`);

            } catch (error) {
                console.error(`Erro ao processar a mensagem:`, error);
            }
        });

        await client.initialize();
        console.log(`initializeClient: client.initialize() concluído.`);
        console.log(`initializeClient: Inicialização concluída com sucesso.`);

        const endTime = Date.now();  // Marca o tempo de fim
        const totalTime = (endTime - startTime) / 1000;  // Calcula o tempo total em segundos
        console.log(`Tempo total de inicialização: ${totalTime} segundos.`);

    } catch (error) {
        console.error(`initializeClient: Erro ao inicializar o cliente:`, error);
        console.error(`initializeClient: Stack trace:`, error.stack);
        reconnectWithBackoff();  // Tenta reconectar em caso de erro na inicialização
    } finally {
        isInitializing = false; // Garante que a flag seja redefinida, mesmo em caso de erro
    }
}

let retryCount = 0; // Contador de tentativas de reconexão

// Função para reconectar com backoff exponencial
async function reconnectWithBackoff() {
    if (isInitializing) {
        console.log("Reconexão já está em andamento. Ignorando chamada.");
        return;
    }

    if (client) { // Verifica se o cliente existe
        try {
            console.log(`Desconectando e fechando o cliente antes de reconectar...`);
            await client.logout(); // Desconecta o cliente
            //await client.destroy(); // Destrói a instância do cliente - Removido conforme instruções
            console.log(`Cliente desconectado.`);
        } catch (disconnectError) {
            console.error(`Erro ao desconectar o cliente:`, disconnectError);
        }
    }

    if (retryCount < MAX_RETRIES) {
        const delayTime = INITIAL_RETRY_DELAY * Math.pow(2, retryCount); // Backoff exponencial
        console.log(`Tentando reconectar em ${delayTime / 1000} segundos (tentativa ${retryCount + 1}/${MAX_RETRIES})...`);

        await delay(delayTime); // Aguarda o tempo de espera antes de tentar reconectar

        try {
            console.log(`Reinicializando o cliente...`);
            retryCount++;
            isReady = false; // Define o cliente como não pronto durante a reconexão

             // Se tivermos os dados do QR code, emitir o evento 'qr' novamente.
            if (qrCodeData) {
                console.log(`Reemitindo o evento QR com os dados salvos.`);
                 client.emit('qr', qrCodeData);
            }
            await initializeClient();  // Tenta inicializar o cliente novamente
        } catch (reconnectError) {
            console.error(`Erro ao reconectar:`, reconnectError);
        }
    } else {
        console.error(`Número máximo de tentativas de reconexão atingido. Desistindo.`);
    }
}


// Função para lidar com as opções do menu
async function handleOption(option, msg, client) {
     if (!isReady) {
        console.warn("Cliente não está pronto, ignorando handleOption.");
        return;
    }

    if (!msg.from.endsWith('@c.us')) return;

    try {
        const chat = await msg.getChat();
        await delay(500);
        await chat.sendStateTyping();
        await delay(500);

        let responseMessage = '';

        switch (option) {
            case '1':
                responseMessage = 'Link para cadastro: https://sites.google.com/view/solucoes-em-ia\n\nTer um(a) Assistente Virtual que atende seus clientes e qualifica LEADS com captação a partir de R$ 1.500,00\n\n*Pagamento 50% Assistente Virtial:* R$ 750,00 MercadoPago Pix E-mail vendamais@gmail.com ou com cartão\n\nTer os templates e arquivos de configurações prontos, mais nosso suporte remote pelo AnyDesk\n\n**Pagamento 50% pelos templates e arquivos de configurações prontos:\n\n* R$ 1.00,00 MercadoPago Pix E-mail vendamais@gmail.com ou com cartão\n\nAgende um contato: WhatsApp (12) 99.750.7961.';
                break;
            case '2':
                responseMessage = 'Link para cadastro: https://sites.google.com/view/solucoes-em-ia\n\nTenha 3 consultas mensais que vão otimizar seu negócio nas Soluções em IA e suporte via remoto através do AnyDesk *Assinatura Mensal:* R$ 99,90 MercadoPago Pix E-mail vendamais@gmail.com ou com cartão\n\nAgende um contato: WhatsApp (12) 99.750.7961.';
                break;
            case '3':
                responseMessage = 'Link para cadastro: https://sites.google.com/view/solucoes-em-ia\n\nSaiba, antes que seja tarde, com quem se relaciona, quem lhe deu um golpe ou de quem você desconfia, a partir de qualquer pequena informação ou detalhe, cpf, nome completo, endereço, cep, placa de carro e outros.\nPequeno Dossiê R$ 75,00.\nMédio Dossiê R$ 150;00.\nCompleto Dossiê R$ 300,00.\n Assinatura Mensal R$ 150,00, com direito a 3 consultas mensais - Cada consulta adicional, R$ 100,00\nPix MercadoPago E-mail vendamais@gmail.com ou com cartão\n\nAgende um contato: WhatsApp (12) 99.750.7961.';
                break;
            case '4':
                responseMessage = 'Agende um contato: WhatsApp (12) 99.750.7961.';
                break;
            case '5':
                responseMessage = 'Se tiver outras dúvidas ou precisar de mais informações, por favor, escreva aqui, visite nosso site: https://sites.google.com/view/solucoes-em-ia/\n\n ou Agende um contato: WhatsApp (12) 99.750.7961.';
                break;
            default:
                responseMessage = 'Opção inválida.';
        }

        // Envia a mensagem de resposta
        try {
            await client.sendMessage(msg.from, responseMessage);
        } catch (sendMessageError) {
            console.error(`Erro ao enviar mensagem de resposta: ${sendMessageError}`);
        }
        // Carrega os dados existentes
        let existingData = await loadData();
        // Encontra o índice do usuário
        const userIndex = existingData.findIndex(u => u.whatsapp === msg.from.replace('@c.us', ''));
        // Se o usuário existe, atualiza as opções escolhidas
        if (userIndex !== -1) {
            existingData[userIndex].opcoes_escolhidas.push(option);
            await saveData(existingData);
        }
    } catch (error) {
        console.error(`Erro ao lidar com a opção:`, error);
    }
}

// ---------------------- Inicialização do Servidor Express ----------------------
app.get('/', (req, res) => {
    res.send('Servidor está rodando! Chatbot WhatsApp DeBocaEmBoca.');
});

app.listen(port, () => {
    console.log(`Servidor Express rodando na porta ${port}`);
});

// Inicializa o cliente
initializeClient();