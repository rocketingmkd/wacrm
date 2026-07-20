import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Termos de Uso",
  robots: { index: true, follow: true },
};

const lastUpdated = "20 de julho de 2026";

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-background px-4 py-16 text-foreground">
      <div className="mx-auto max-w-2xl">
        <h1 className="text-2xl font-semibold">Termos de Uso</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Última atualização: {lastUpdated}
        </p>

        <div className="mt-8 flex flex-col gap-6 text-sm leading-relaxed text-muted-foreground [&_h2]:mt-4 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-foreground [&_p]:mt-2 [&_ul]:mt-2 [&_ul]:list-disc [&_ul]:pl-5 [&_li]:mt-1">
          <section>
            <h2>1. Aceitação dos termos</h2>
            <p>
              Estes Termos de Uso regem o acesso e uso do Rocketing CRM,
              plataforma operada por{" "}
              <strong className="text-foreground">
                56.824.260 LEANDRO FERREIRA GOMES JUNIOR
              </strong>{" "}
              (CNPJ 56.824.260/0001-36), doravante &quot;Rocketing&quot;.
              Ao criar uma conta ou usar a plataforma, você concorda com
              estes termos e com a nossa Política de Privacidade.
            </p>
          </section>

          <section>
            <h2>2. Descrição do serviço</h2>
            <p>
              O Rocketing CRM é uma plataforma de gestão de relacionamento
              com clientes integrada à API oficial do WhatsApp Business
              (Meta), oferecendo caixa de entrada compartilhada, funis de
              venda, disparos, automações e recursos opcionais de
              inteligência artificial.
            </p>
          </section>

          <section>
            <h2>3. Cadastro e conta</h2>
            <ul>
              <li>Você é responsável por fornecer informações verdadeiras no cadastro e por mantê-las atualizadas.</li>
              <li>Você é responsável por manter sua senha em sigilo e por toda atividade realizada na sua conta.</li>
              <li>Contas de equipe (administrador, agente, visualizador) têm permissões diferentes, definidas por quem administra a conta.</li>
            </ul>
          </section>

          <section>
            <h2>4. Uso aceitável</h2>
            <p>Ao usar a plataforma, você concorda em não:</p>
            <ul>
              <li>Enviar mensagens não solicitadas (spam) ou violar as políticas comerciais e de uso do WhatsApp/Meta.</li>
              <li>Usar a plataforma para fins ilegais, fraudulentos ou que violem direitos de terceiros.</li>
              <li>Tentar acessar dados de outras contas ou contornar mecanismos de segurança da plataforma.</li>
              <li>Fazer engenharia reversa, revender acesso não autorizado ou sobrecarregar a infraestrutura deliberadamente.</li>
            </ul>
            <p>
              O descumprimento das regras de disparo e opt-in do WhatsApp
              pode levar ao bloqueio do seu número pela própria Meta,
              independentemente de ação do Rocketing.
            </p>
          </section>

          <section>
            <h2>5. Dados de terceiros que você trata na plataforma</h2>
            <p>
              Você é responsável por ter base legal (LGPD) para tratar os
              dados dos contatos que cadastra ou importa no CRM, incluindo
              consentimento para contato via WhatsApp quando aplicável. O
              Rocketing atua como operador desses dados, seguindo as
              instruções da sua conta.
            </p>
          </section>

          <section>
            <h2>6. Disponibilidade do serviço</h2>
            <p>
              Empregamos esforços razoáveis para manter a plataforma
              disponível, mas não garantimos operação ininterrupta.
              Manutenções, atualizações ou instabilidades de provedores
              terceiros (incluindo a API da Meta) podem causar
              indisponibilidade temporária.
            </p>
          </section>

          <section>
            <h2>7. Propriedade intelectual</h2>
            <p>
              A marca Rocketing CRM e sua identidade visual pertencem ao
              Rocketing. Os dados que você insere na plataforma (contatos,
              conversas, configurações) continuam sendo seus.
            </p>
          </section>

          <section>
            <h2>8. Limitação de responsabilidade</h2>
            <p>
              O Rocketing não se responsabiliza por perdas decorrentes de
              uso indevido da plataforma, indisponibilidade de serviços de
              terceiros (Meta/WhatsApp, provedores de e-mail ou de IA), ou
              por decisões de negócio tomadas com base em dados ou
              automações configuradas pelo próprio usuário.
            </p>
          </section>

          <section>
            <h2>9. Cancelamento</h2>
            <p>
              Você pode encerrar sua conta a qualquer momento pelo contato
              abaixo. Podemos suspender ou encerrar contas que violem estes
              termos, mediante aviso prévio quando razoavelmente possível.
            </p>
          </section>

          <section>
            <h2>10. Alterações nestes termos</h2>
            <p>
              Podemos atualizar estes termos periodicamente. O uso
              continuado da plataforma após alterações relevantes constitui
              aceitação dos novos termos.
            </p>
          </section>

          <section>
            <h2>11. Legislação aplicável</h2>
            <p>
              Estes termos são regidos pelas leis da República Federativa
              do Brasil, com foro eleito na comarca de Londrina, PR, para
              dirimir eventuais controvérsias.
            </p>
          </section>

          <section>
            <h2>12. Contato</h2>
            <p>
              Dúvidas sobre estes termos:{" "}
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
