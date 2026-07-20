import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Política de Privacidade",
  robots: { index: true, follow: true },
};

const lastUpdated = "20 de julho de 2026";

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background px-4 py-16 text-foreground">
      <div className="mx-auto max-w-2xl">
        <h1 className="text-2xl font-semibold">Política de Privacidade</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Última atualização: {lastUpdated}
        </p>

        <div className="mt-8 flex flex-col gap-6 text-sm leading-relaxed text-muted-foreground [&_h2]:mt-4 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-foreground [&_p]:mt-2 [&_ul]:mt-2 [&_ul]:list-disc [&_ul]:pl-5 [&_li]:mt-1">
          <section>
            <h2>1. Quem somos</h2>
            <p>
              O Rocketing CRM é operado por{" "}
              <strong className="text-foreground">
                56.824.260 LEANDRO FERREIRA GOMES JUNIOR
              </strong>{" "}
              (CNPJ 56.824.260/0001-36), sediado em Londrina, PR, doravante
              &quot;Rocketing&quot;, &quot;nós&quot;. Esta política explica
              quais dados coletamos, como usamos e quais direitos você tem
              sobre eles, em conformidade com a Lei Geral de Proteção de
              Dados (Lei nº 13.709/2018, &quot;LGPD&quot;).
            </p>
          </section>

          <section>
            <h2>2. Quais dados coletamos</h2>
            <p>Ao usar o Rocketing CRM, tratamos os seguintes dados:</p>
            <ul>
              <li>
                <strong className="text-foreground">Dados da sua conta:</strong>{" "}
                nome, e-mail, senha (armazenada com hash), foto de perfil e
                perfil de acesso na equipe.
              </li>
              <li>
                <strong className="text-foreground">
                  Dados que você cadastra no CRM:
                </strong>{" "}
                contatos (nome, telefone, e-mail, empresa, etiquetas, notas,
                campos personalizados), negócios em funis de venda e
                configurações de automações.
              </li>
              <li>
                <strong className="text-foreground">
                  Conteúdo de mensagens do WhatsApp:
                </strong>{" "}
                mensagens trocadas com seus contatos através da API oficial
                do WhatsApp Business (Meta), incluindo texto, mídia e status
                de entrega/leitura.
              </li>
              <li>
                <strong className="text-foreground">Dados técnicos:</strong>{" "}
                endereço IP, tipo de navegador e registros de acesso, usados
                apenas para segurança e diagnóstico.
              </li>
            </ul>
          </section>

          <section>
            <h2>3. Como usamos os dados</h2>
            <ul>
              <li>Operar a plataforma: autenticação, envio e recebimento de mensagens, funis de venda, disparos e automações.</li>
              <li>Enviar e-mails transacionais (confirmação de cadastro, redefinição de senha, convites de equipe).</li>
              <li>
                Processar mensagens com inteligência artificial, apenas se
                a sua conta configurar isso ativamente com uma chave própria
                de um provedor de IA (OpenAI ou Anthropic). Sem essa
                configuração, nenhum dado é enviado a esses provedores.
              </li>
              <li>Garantir a segurança da plataforma e prevenir uso indevido.</li>
            </ul>
          </section>

          <section>
            <h2>4. Com quem compartilhamos dados</h2>
            <p>Não vendemos seus dados. Compartilhamos apenas o necessário para operar o serviço:</p>
            <ul>
              <li>
                <strong className="text-foreground">Meta (WhatsApp Business Platform):</strong>{" "}
                mensagens trafegam pela API oficial da Meta para chegarem
                aos seus contatos.
              </li>
              <li>
                <strong className="text-foreground">Infraestrutura de hospedagem:</strong>{" "}
                banco de dados e armazenamento operados em servidor próprio,
                com criptografia de credenciais sensíveis (AES-256-GCM) e
                isolamento de dados por conta.
              </li>
              <li>
                <strong className="text-foreground">Provedores de IA (opcional):</strong>{" "}
                somente se você mesmo configurar uma chave de API própria
                nas Configurações da sua conta.
              </li>
            </ul>
          </section>

          <section>
            <h2>5. Por quanto tempo guardamos os dados</h2>
            <p>
              Mantemos os dados enquanto sua conta estiver ativa. Ao
              solicitar o encerramento da conta, os dados são removidos em
              até 30 dias, exceto quando a lei exigir retenção por prazo
              maior (por exemplo, obrigações fiscais).
            </p>
          </section>

          <section>
            <h2>6. Segurança</h2>
            <p>
              Tokens de acesso e credenciais sensíveis são armazenados
              criptografados (AES-256-GCM). O acesso aos dados de cada conta
              é isolado por controle de acesso em nível de linha (RLS) no
              banco de dados, e conexões usam HTTPS/TLS.
            </p>
          </section>

          <section>
            <h2>7. Seus direitos (LGPD)</h2>
            <p>Você pode, a qualquer momento, solicitar:</p>
            <ul>
              <li>Confirmação da existência de tratamento e acesso aos seus dados.</li>
              <li>Correção de dados incompletos, inexatos ou desatualizados.</li>
              <li>Anonimização, bloqueio ou eliminação de dados desnecessários.</li>
              <li>Portabilidade dos dados a outro fornecedor.</li>
              <li>Eliminação dos dados tratados com base no seu consentimento.</li>
              <li>Informação sobre com quem compartilhamos seus dados.</li>
            </ul>
            <p>
              Para exercer qualquer um desses direitos, entre em contato pelo
              e-mail abaixo.
            </p>
          </section>

          <section>
            <h2>8. Cookies</h2>
            <p>
              Usamos apenas cookies essenciais de sessão, para manter você
              autenticado. Não usamos cookies de rastreamento publicitário.
            </p>
          </section>

          <section>
            <h2>9. Alterações a esta política</h2>
            <p>
              Podemos atualizar esta política periodicamente. Mudanças
              relevantes serão comunicadas por e-mail ou aviso na
              plataforma.
            </p>
          </section>

          <section>
            <h2>10. Contato</h2>
            <p>
              Dúvidas, solicitações sobre seus dados ou exercício de
              direitos da LGPD:{" "}
              <a
                href="mailto:crm@rocketingmkd.com.br"
                className="text-primary hover:text-primary/80"
              >
                crm@rocketingmkd.com.br
              </a>
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
