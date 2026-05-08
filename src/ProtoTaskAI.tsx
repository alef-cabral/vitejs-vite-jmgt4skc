import { useState, useRef } from 'react';

const MONDAY_MCP = 'https://mcp.monday.com/mcp';

const STATUS = {
  IDLE: 'idle',
  READING_PDF: 'reading_pdf',
  GENERATING: 'generating',
  CREATING_MONDAY: 'creating_monday',
  DONE: 'done',
  ERROR: 'error',
};

const COLORS = {
  Frontend: { border: '#22c55e', text: '#4ade80', badge: '#14532d' },
  Backend: { border: '#3b82f6', text: '#60a5fa', badge: '#1e3a5f' },
};

function safeParseJSON(raw) {
  const tries = [
    () => JSON.parse(raw.trim()),
    () =>
      JSON.parse(
        raw
          .replace(/```(?:json)?\s*/gi, '')
          .replace(/```/g, '')
          .trim()
      ),
    () => {
      const s = raw.indexOf('{'),
        e = raw.lastIndexOf('}');
      if (s !== -1 && e > s) return JSON.parse(raw.slice(s, e + 1));
      throw 0;
    },
  ];
  for (const fn of tries) {
    try {
      const r = fn();
      if (r) return r;
    } catch {}
  }
  return null;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = () => reject(new Error('Falha ao ler o arquivo.'));
    reader.readAsDataURL(file);
  });
}

function buildFallback() {
  return {
    epic: {
      title: 'Implementação do Layout',
      description:
        'Desenvolvimento completo do layout com base no PDF fornecido.',
    },
    frontend: {
      title: 'Desenvolvimento do Layout Completo',
      type: 'Frontend',
      explanation:
        'Implementar o layout completo conforme o PDF: estrutura de página, header, navegação, seções de conteúdo, componentes visuais, tipografia, espaçamentos, imagens e footer, garantindo fidelidade ao protótipo e responsividade em todos os breakpoints.',
      criteria: [
        'Todos os elementos visuais do PDF estão implementados fielmente',
        'Layout responsivo em mobile, tablet e desktop',
        'Tipografia, cores e espaçamentos seguem o protótipo',
        'Imagens e mídias carregam corretamente com lazy-load',
        'Componentes acessíveis via teclado e leitores de tela',
        'Aprovado em revisão de UI contra o PDF original',
      ],
      conclusion:
        'Layout completo implementado, validado contra o PDF em todos os breakpoints e aprovado em revisão de UI.',
    },
    backend: {
      title: 'APIs e Integrações de Suporte ao Layout',
      type: 'Backend',
      explanation:
        'Desenvolver os endpoints e integrações necessários para suportar o conteúdo dinâmico identificado no layout: APIs de conteúdo, serviço de mídia e integrações com serviços externos.',
      criteria: [
        'Endpoints retornam os dados esperados pelo frontend',
        'Tempo de resposta inferior a 300ms',
        'Falhas em serviços externos não derrubam a página (graceful degradation)',
        'APIs documentadas com OpenAPI/Swagger',
      ],
      conclusion:
        'APIs e integrações disponíveis, documentadas e integradas ao frontend com tratamento de erros implementado.',
    },
    hasBackend: true,
  };
}

async function callClaude(system, messages, mcpServers = [], maxTokens = 5000) {
  const body: any = {
    model: 'claude-sonnet-4-20250514',
    max_tokens: maxTokens,
    system,
    messages,
  };
  if (mcpServers.length) body.mcp_servers = mcpServers;
  const res = await fetch("/api/anthropic/v1/messages", {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

const getText = (d) =>
  (d.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n');

// ─────────────────────────────────────────────────────────────────────────────
export default function ProtoTaskAI() {
  const [pdfFile, setPdfFile] = useState(null);
  const [pdfName, setPdfName] = useState('');
  const [boardName, setBoardName] = useState('Tarefas - PIlar de Atração');
  const [status, setStatus] = useState(STATUS.IDLE);
  const [log, setLog] = useState([]);
  const [tasks, setTasks] = useState(null);
  const [error, setError] = useState(null);
  const [created, setCreated] = useState([]);
  const [expanded, setExpanded] = useState({});
  const [dragging, setDragging] = useState(false);
  const [comments, setComments] = useState({
    epic: '',
    frontend: '',
    backend: '',
  });
  const fileRef = useRef<HTMLInputElement>(null);

  const updateComment = (key, val) =>
    setComments((p) => ({ ...p, [key]: val }));

  const addLog = (msg, type = 'info') =>
    setLog((p) => [
      ...p,
      { msg, type, ts: new Date().toLocaleTimeString('pt-BR') },
    ]);
  const toggle = (k) => setExpanded((p) => ({ ...p, [k]: !p[k] }));

  function handleFile(file) {
    if (!file || file.type !== 'application/pdf') {
      setError('Envie um arquivo PDF válido.');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setError('Arquivo muito grande. Limite: 20MB.');
      return;
    }
    setError(null);
    setPdfFile(file);
    setPdfName(file.name);
  }

  function onDrop(e) {
    e.preventDefault();
    setDragging(false);
    handleFile(e.dataTransfer.files[0]);
  }

  async function run() {
    if (!pdfFile) {
      setError('Selecione um arquivo PDF primeiro.');
      return;
    }
    setStatus(STATUS.READING_PDF);
    setLog([]);
    setTasks(null);
    setError(null);
    setCreated([]);
    setExpanded({});
    setComments({ epic: '', frontend: '', backend: '' });

    try {
      // ── 1. Ler PDF visualmente ────────────────────────────────────────────
      addLog('📄 Carregando PDF...', 'info');
      const base64 = await fileToBase64(pdfFile);
      addLog(
        `✅ PDF carregado (${(pdfFile.size / 1024).toFixed(0)} KB)`,
        'success'
      );
      addLog('🔍 Analisando layout visualmente...', 'info');

      const analysisData = await callClaude(
        'Você é especialista em análise de layouts de interface. Analise visualmente o PDF e descreva com detalhe todos os elementos de UI: header, navegação, banners, seções, tipografia, imagens, cards, formulários, botões, footer, cores, integrações externas visíveis (redes sociais, mapas, feeds etc). Indique claramente se o layout exige integrações de backend como APIs de conteúdo, feeds sociais, formulários ou autenticação.',
        [
          {
            role: 'user',
            content: [
              {
                type: 'document',
                source: {
                  type: 'base64',
                  media_type: 'application/pdf',
                  data: base64,
                },
              },
              {
                type: 'text',
                text: 'Analise este PDF de layout e descreva: 1) todos os elementos visuais e componentes de UI, 2) se há necessidade de backend (APIs, integrações, dados dinâmicos, formulários) — seja explícito sobre isso.',
              },
            ],
          },
        ],
        [],
        4000
      );
      const layoutDescription = getText(analysisData);
      addLog(
        `✅ Layout analisado (${layoutDescription.length} chars)`,
        'success'
      );

      // ── 2. Gerar 1 tarefa FE + 1 tarefa BE (se necessário) ────────────────
      setStatus(STATUS.GENERATING);
      addLog('🧠 Gerando tarefas com base no layout...', 'info');

      const taskData = await callClaude(
        `Você é um Tech Lead sênior. Analise a descrição do layout e gere EXATAMENTE:
- 1 tarefa de Frontend cobrindo o desenvolvimento completo do layout
- 1 tarefa de Backend SOMENTE se o layout realmente exigir APIs, integrações ou dados dinâmicos; caso contrário, omita o campo "backend"

REGRA ABSOLUTA: retorne SOMENTE JSON válido. Sem texto antes ou depois. Sem markdown.

Estrutura quando há backend:
{"epic":{"title":"string","description":"string"},"frontend":{"title":"string","type":"Frontend","explanation":"string detalhado sobre todo o layout a implementar","criteria":["string","string","string","string"],"conclusion":"string"},"backend":{"title":"string","type":"Backend","explanation":"string","criteria":["string","string","string"],"conclusion":"string"},"hasBackend":true}

Estrutura quando NÃO há backend:
{"epic":{"title":"string","description":"string"},"frontend":{"title":"string","type":"Frontend","explanation":"string detalhado","criteria":["string","string","string","string"],"conclusion":"string"},"hasBackend":false}

A tarefa de Frontend deve cobrir o layout INTEIRO (não divida por seção). Seja específico, referenciando elementos reais identificados no layout.`,
        [
          {
            role: 'user',
            content: `DESCRIÇÃO DO LAYOUT:\n\n${layoutDescription}\n\nGere o JSON com as tarefas.`,
          },
        ],
        [],
        4000
      );

      const raw = getText(taskData);
      addLog(`📦 Resposta recebida (${raw.length} chars)`, 'info');

      let parsed = safeParseJSON(raw);
      if (!parsed || !parsed.frontend) {
        addLog('⚠️ Usando fallback baseado no layout', 'warn');
        parsed = buildFallback();
      }

      setTasks(parsed);
      const beLabel = parsed.hasBackend
        ? ' + 1 tarefa Backend'
        : ' (sem Backend necessário)';
      addLog(`✅ 1 tarefa Frontend${beLabel}`, 'success');

      // ── 3. Criar no Monday ────────────────────────────────────────────────
      setStatus(STATUS.CREATING_MONDAY);
      addLog('📋 Buscando board no Monday...', 'info');

      const boardData = await callClaude(
        'Gerencie o Monday.com via MCP. Retorne SOMENTE JSON.',
        [
          {
            role: 'user',
            content: `Busque o board "${boardName}". Retorne: {"boardId":"string"}`,
          },
        ],
        [{ type: 'url', url: MONDAY_MCP, name: 'monday' }],
        2000
      );
      const bText = getText(boardData);
      const bMatch =
        bText.match(/"boardId"\s*:\s*"?(\d+)"?/) || bText.match(/\b(\d{7,})\b/);
      const boardId = bMatch ? bMatch[1] : null;
      if (!boardId)
        throw new Error(
          `Board "${boardName}" não encontrado. Verifique o nome exato.`
        );
      addLog(`✅ Board encontrado #${boardId}`, 'success');

      // Epic
      addLog('🚀 Criando Epic no Monday...', 'info');
      const epicRes = await callClaude(
        'Gerencie o Monday.com via MCP.',
        [
          {
            role: 'user',
            content: `Crie item no board ${boardId} com título "[EPIC] ${
              parsed.epic.title
            }". Descrição: "${
              comments.epic || parsed.epic.description
            }". Retorne {"itemId":"string"}`,
          },
        ],
        [{ type: 'url', url: MONDAY_MCP, name: 'monday' }],
        2000
      );
      const eText = getText(epicRes);
      const eMatch =
        eText.match(/"itemId"\s*:\s*"?(\d+)"?/) || eText.match(/\b(\d{7,})\b/);
      const epicId = eMatch ? eMatch[1] : null;
      const createdList = [
        { type: 'epic', title: parsed.epic.title, id: epicId },
      ];
      addLog(`✅ Epic criado${epicId ? ` #${epicId}` : ''}`, 'success');

      // Tarefa Frontend
      const tasksToCreate = [parsed.frontend];
      if (parsed.hasBackend && parsed.backend)
        tasksToCreate.push(parsed.backend);

      // Subelemento board: 18391805297 | coluna "Texto": text_mm34w7h0
      const SUBITEM_BOARD_ID = 18391805297;
      const SUBITEM_TEXT_COL = 'text_mm34w7h0';

      for (const task of tasksToCreate) {
        try {
          const commentKey = task.type === 'Frontend' ? 'frontend' : 'backend';
          const userComment = comments[commentKey] || '';

          // Coluna Texto: usa comentário do usuário se preenchido, senão a explicação gerada
          const textColValue = (userComment || task.explanation)
            .replace(/"/g, "'")
            .replace(/[\n\r]/g, ' ');
          const colValues = JSON.stringify({
            [SUBITEM_TEXT_COL]: textColValue,
          });

          // 1. Criar subelemento com coluna Texto já no payload
          const p = epicId
            ? `Use create_item do Monday MCP: boardId=${SUBITEM_BOARD_ID}, parentItemId=${epicId}, name="[${task.type}] ${task.title}", columnValues=${colValues}. Retorne {"itemId":"string"}`
            : `Use create_item do Monday MCP: boardId=${boardId}, name="[${task.type}] ${task.title}", columnValues={}. Retorne {"itemId":"string"}`;

          const r = await callClaude(
            'Gerencie o Monday.com via MCP. Execute create_item com os parâmetros exatos.',
            [{ role: 'user', content: p }],
            [{ type: 'url', url: MONDAY_MCP, name: 'monday' }],
            2000
          );
          const rt = getText(r);
          const idM =
            rt.match(/"itemId"\s*:\s*"?(\d+)"?/) || rt.match(/(\d{7,})/);
          const newItemId = idM ? idM[1] : null;
          createdList.push({
            type: task.type,
            title: task.title,
            id: newItemId,
          });
          addLog(`  ↳ [${task.type}] ${task.title}`, 'success');

          // 2. Garantir coluna Texto preenchida via change_item_column_values
          if (newItemId) {
            try {
              await callClaude(
                'Gerencie o Monday.com via MCP. Execute change_item_column_values com os parâmetros exatos.',
                [
                  {
                    role: 'user',
                    content: `Use change_item_column_values: boardId=${SUBITEM_BOARD_ID}, itemId=${newItemId}, columnValues={"${SUBITEM_TEXT_COL}":"${textColValue}"}`,
                  },
                ],
                [{ type: 'url', url: MONDAY_MCP, name: 'monday' }],
                2000
              );
              addLog(`     ✔ Coluna "Texto" preenchida`, 'success');
            } catch {
              addLog(`     ⚠️ Coluna "Texto" não preenchida`, 'warn');
            }
          }
        } catch {
          addLog(`  ⚠️ Erro ao criar: ${task.title}`, 'warn');
        }
      }

      setCreated(createdList);
      setStatus(STATUS.DONE);
      addLog(
        `🎉 Concluído! ${createdList.length} itens criados no Monday.`,
        'success'
      );
    } catch (err) {
      setError(err.message);
      setStatus(STATUS.ERROR);
      addLog(`❌ ${err.message}`, 'error');
    }
  }

  const isRunning = [
    STATUS.READING_PDF,
    STATUS.GENERATING,
    STATUS.CREATING_MONDAY,
  ].includes(status);
  const stepOrder = [
    STATUS.READING_PDF,
    STATUS.GENERATING,
    STATUS.CREATING_MONDAY,
    STATUS.DONE,
  ];
  const stepLabels = [
    { key: STATUS.READING_PDF, label: 'Análise do PDF' },
    { key: STATUS.GENERATING, label: 'Geração de Tarefas' },
    { key: STATUS.CREATING_MONDAY, label: 'Criação no Monday' },
  ];
  const curStep = stepOrder.indexOf(status);
  const displayTasks = tasks
    ? [
        tasks.frontend,
        ...(tasks.hasBackend && tasks.backend ? [tasks.backend] : []),
      ].filter(Boolean)
    : [];

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#07070f',
        fontFamily: "'DM Mono','Fira Code',monospace",
        color: '#e2e2e8',
        padding: '28px 20px',
      }}
    >
      {/* Header */}
      <div
        style={{
          marginBottom: 26,
          paddingBottom: 18,
          borderBottom: '1px solid #131322',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            marginBottom: 4,
          }}
        >
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background:
                status === STATUS.DONE
                  ? '#4ade80'
                  : status === STATUS.ERROR
                  ? '#f87171'
                  : isRunning
                  ? '#facc15'
                  : '#6366f1',
              boxShadow: `0 0 10px ${
                status === STATUS.DONE
                  ? '#4ade8055'
                  : status === STATUS.ERROR
                  ? '#f8717155'
                  : isRunning
                  ? '#facc1555'
                  : '#6366f155'
              }`,
              animation: isRunning ? 'pulse 1.4s infinite' : 'none',
            }}
          />
          <span
            style={{
              fontSize: 9,
              color: '#6366f1',
              letterSpacing: 3,
              textTransform: 'uppercase',
            }}
          >
            ProtoTask · AI v7
          </span>
        </div>
        <h1
          style={{
            margin: 0,
            fontSize: 19,
            fontWeight: 700,
            color: '#fff',
            letterSpacing: -0.5,
          }}
        >
          PDF → Tarefas Técnicas → Monday
        </h1>
        <p style={{ margin: '4px 0 0', fontSize: 11, color: '#44445a' }}>
          Analisa o layout, gera tarefas e permite adicionar descrições antes de
          enviar ao Monday
        </p>
      </div>

      {/* Upload PDF */}
      <div style={{ marginBottom: 14 }}>
        <label
          style={{
            fontSize: 9,
            color: '#6366f1',
            letterSpacing: 2,
            textTransform: 'uppercase',
            display: 'block',
            marginBottom: 8,
          }}
        >
          Arquivo PDF do Layout
        </label>
        <div
          onClick={() => !isRunning && fileRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          style={{
            border: `2px dashed ${
              dragging ? '#6366f1' : pdfFile ? '#22c55e' : '#1e1e30'
            }`,
            borderRadius: 10,
            padding: '26px 20px',
            textAlign: 'center',
            cursor: isRunning ? 'not-allowed' : 'pointer',
            background: dragging ? '#0d0d1e' : pdfFile ? '#0a180a' : '#0c0c1a',
            transition: 'all .2s',
          }}
        >
          {pdfFile ? (
            <div>
              <div style={{ fontSize: 26, marginBottom: 5 }}>📄</div>
              <div style={{ fontSize: 12, color: '#4ade80', fontWeight: 700 }}>
                {pdfName}
              </div>
              <div style={{ fontSize: 10, color: '#336644', marginTop: 3 }}>
                {(pdfFile.size / 1024).toFixed(0)} KB · clique para trocar
              </div>
            </div>
          ) : (
            <div>
              <div style={{ fontSize: 30, marginBottom: 7 }}>⬆</div>
              <div style={{ fontSize: 12, color: '#44445a' }}>
                Arraste o PDF aqui ou{' '}
                <span style={{ color: '#6366f1' }}>clique para selecionar</span>
              </div>
              <div style={{ fontSize: 10, color: '#2a2a40', marginTop: 5 }}>
                Exportado do Figma, Zeplin ou qualquer ferramenta · máx 20MB
              </div>
            </div>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf"
          style={{ display: 'none' }}
          onChange={(e) => handleFile(e.target.files[0])}
        />
      </div>

      {/* Board Monday */}
      <div style={{ marginBottom: 20 }}>
        <label
          style={{
            fontSize: 9,
            color: '#6366f1',
            letterSpacing: 2,
            textTransform: 'uppercase',
            display: 'block',
            marginBottom: 6,
          }}
        >
          Board do Monday
        </label>
        <input
          value={boardName}
          onChange={(e) => setBoardName(e.target.value)}
          disabled={isRunning}
          placeholder="Nome exato do board"
          style={{
            width: '100%',
            boxSizing: 'border-box',
            background: '#0c0c1a',
            border: '1px solid #1e1e30',
            borderRadius: 6,
            padding: '9px 13px',
            color: '#e2e2e8',
            fontSize: 11,
            fontFamily: 'inherit',
            outline: 'none',
          }}
        />
      </div>

      {/* Botão */}
      <button
        onClick={run}
        disabled={isRunning || !pdfFile || !boardName}
        style={{
          width: '100%',
          padding: 12,
          background: isRunning
            ? '#0f0f1e'
            : 'linear-gradient(135deg,#6366f1,#8b5cf6)',
          border: 'none',
          borderRadius: 8,
          color: isRunning ? '#33334a' : '#fff',
          fontSize: 11,
          fontFamily: 'inherit',
          fontWeight: 700,
          letterSpacing: 2,
          textTransform: 'uppercase',
          cursor: isRunning ? 'not-allowed' : 'pointer',
          marginBottom: 22,
        }}
      >
        {isRunning
          ? '⟳  Processando...'
          : status === STATUS.DONE
          ? '↻  Rodar Novamente'
          : '▶  Executar ProtoTask'}
      </button>

      {/* Steps */}
      {status !== STATUS.IDLE && (
        <div style={{ display: 'flex', gap: 5, marginBottom: 18 }}>
          {stepLabels.map((s) => {
            const idx = stepOrder.indexOf(s.key),
              done = curStep > idx,
              act = curStep === idx;
            return (
              <div
                key={s.key}
                style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <div
                  style={{
                    width: '100%',
                    height: 2,
                    borderRadius: 2,
                    background: done ? '#6366f1' : act ? '#facc15' : '#161625',
                    transition: 'background .4s',
                  }}
                />
                <span
                  style={{
                    fontSize: 8,
                    color: done ? '#6366f1' : act ? '#facc15' : '#2a2a40',
                    letterSpacing: 1,
                    textAlign: 'center',
                  }}
                >
                  {done ? '✓ ' : ''}
                  {s.label}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Log */}
      {log.length > 0 && (
        <div
          style={{
            background: '#050510',
            border: '1px solid #111120',
            borderRadius: 8,
            padding: '11px 13px',
            marginBottom: 20,
            maxHeight: 150,
            overflowY: 'auto',
          }}
        >
          <div
            style={{
              fontSize: 8,
              color: '#222235',
              letterSpacing: 2,
              marginBottom: 7,
              textTransform: 'uppercase',
            }}
          >
            // log
          </div>
          {log.map((e, i) => (
            <div
              key={i}
              style={{
                fontSize: 10,
                marginBottom: 3,
                color:
                  e.type === 'success'
                    ? '#4ade80'
                    : e.type === 'error'
                    ? '#f87171'
                    : e.type === 'warn'
                    ? '#facc15'
                    : '#5a5a78',
              }}
            >
              <span style={{ color: '#222235', marginRight: 7 }}>[{e.ts}]</span>
              {e.msg}
            </div>
          ))}
        </div>
      )}

      {/* Tarefas */}
      {tasks && (
        <div style={{ marginBottom: 20 }}>
          {/* Epic */}
          <div
            style={{
              background: '#0b0b1c',
              border: '1px solid #6366f125',
              borderLeft: '3px solid #6366f1',
              borderRadius: 8,
              padding: '12px 14px',
              marginBottom: 12,
            }}
          >
            <div
              style={{
                fontSize: 8,
                color: '#6366f1',
                letterSpacing: 2,
                marginBottom: 3,
              }}
            >
              EPIC
            </div>
            <div
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: '#fff',
                marginBottom: 6,
              }}
            >
              {tasks.epic?.title}
            </div>
            <div
              style={{
                fontSize: 11,
                color: '#44445a',
                lineHeight: 1.5,
                marginBottom: 10,
              }}
            >
              {tasks.epic?.description}
            </div>
            <div
              style={{
                fontSize: 8,
                color: '#6366f1',
                letterSpacing: 2,
                textTransform: 'uppercase',
                marginBottom: 5,
              }}
            >
              💬 Descrição / Comentário
            </div>
            <textarea
              value={comments.epic}
              onChange={(e) => updateComment('epic', e.target.value)}
              placeholder="Adicione um comentário ou contexto para o Epic..."
              rows={3}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                background: '#060612',
                border: '1px solid #2a2a40',
                borderRadius: 6,
                padding: '9px 11px',
                color: '#c0c0d8',
                fontSize: 11,
                fontFamily: 'inherit',
                resize: 'vertical',
                outline: 'none',
                lineHeight: 1.6,
              }}
            />
          </div>

          {/* Badge de resultado */}
          <div
            style={{
              fontSize: 9,
              color: '#44445a',
              letterSpacing: 1,
              marginBottom: 10,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <span style={{ color: '#22c55e' }}>◆</span> 1 tarefa Frontend
            {tasks.hasBackend ? (
              <>
                <span style={{ color: '#3b82f6', marginLeft: 4 }}>◆</span> 1
                tarefa Backend
              </>
            ) : (
              <span style={{ color: '#2a2a40', marginLeft: 4 }}>
                — sem Backend necessário
              </span>
            )}
          </div>

          {/* Cards */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {displayTasks.map((task, i) => {
              const c = COLORS[task.type] || COLORS.Frontend,
                k = `task-${i}`,
                open = expanded[k];
              return (
                <div
                  key={k}
                  style={{
                    background: '#09091a',
                    border: `1px solid ${open ? c.border : '#161625'}`,
                    borderLeft: `3px solid ${c.border}`,
                    borderRadius: 8,
                    overflow: 'hidden',
                    transition: 'border-color .2s',
                  }}
                >
                  {/* Cabeçalho */}
                  <div
                    onClick={() => toggle(k)}
                    style={{
                      padding: '13px 15px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 10,
                    }}
                  >
                    <div
                      style={{ display: 'flex', alignItems: 'center', gap: 10 }}
                    >
                      <span
                        style={{
                          fontSize: 8,
                          padding: '3px 9px',
                          background: c.badge,
                          color: c.text,
                          borderRadius: 3,
                          letterSpacing: 1,
                          fontWeight: 700,
                          flexShrink: 0,
                        }}
                      >
                        {task.type}
                      </span>
                      <span
                        style={{
                          fontSize: 13,
                          color: '#d0d0e8',
                          fontWeight: 700,
                        }}
                      >
                        {task.title}
                      </span>
                    </div>
                    <span
                      style={{
                        color: c.text,
                        fontSize: 18,
                        display: 'inline-block',
                        transform: open ? 'rotate(90deg)' : 'none',
                        transition: 'transform .2s',
                        flexShrink: 0,
                      }}
                    >
                      ›
                    </span>
                  </div>

                  {/* Expandido */}
                  {open && (
                    <div
                      style={{
                        padding: '0 15px 15px',
                        borderTop: '1px solid #111120',
                      }}
                    >
                      <div style={{ marginTop: 12 }}>
                        <div
                          style={{
                            fontSize: 8,
                            color: c.text,
                            letterSpacing: 2,
                            textTransform: 'uppercase',
                            marginBottom: 6,
                          }}
                        >
                          📋 Explicação
                        </div>
                        <div
                          style={{
                            fontSize: 11,
                            color: '#8888a8',
                            lineHeight: 1.8,
                            background: '#060612',
                            borderRadius: 6,
                            padding: '11px 13px',
                          }}
                        >
                          {task.explanation}
                        </div>
                      </div>

                      <div style={{ marginTop: 12 }}>
                        <div
                          style={{
                            fontSize: 8,
                            color: c.text,
                            letterSpacing: 2,
                            textTransform: 'uppercase',
                            marginBottom: 6,
                          }}
                        >
                          ✅ Critérios de Aceite
                        </div>
                        <div
                          style={{
                            background: '#060612',
                            borderRadius: 6,
                            padding: '11px 13px',
                          }}
                        >
                          {(task.criteria || []).map((cr, j) => (
                            <div
                              key={j}
                              style={{
                                display: 'flex',
                                gap: 9,
                                marginBottom:
                                  j < task.criteria.length - 1 ? 8 : 0,
                              }}
                            >
                              <span
                                style={{
                                  color: c.text,
                                  fontSize: 9,
                                  marginTop: 2,
                                  flexShrink: 0,
                                }}
                              >
                                ◆
                              </span>
                              <span
                                style={{
                                  fontSize: 11,
                                  color: '#8888a8',
                                  lineHeight: 1.65,
                                }}
                              >
                                {cr}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div style={{ marginTop: 12 }}>
                        <div
                          style={{
                            fontSize: 8,
                            color: c.text,
                            letterSpacing: 2,
                            textTransform: 'uppercase',
                            marginBottom: 6,
                          }}
                        >
                          🏁 Conclusão
                        </div>
                        <div
                          style={{
                            fontSize: 11,
                            color: '#8888a8',
                            lineHeight: 1.8,
                            background: '#060612',
                            borderRadius: 6,
                            padding: '11px 13px',
                            borderLeft: `2px solid ${c.border}`,
                          }}
                        >
                          {task.conclusion}
                        </div>
                      </div>

                      <div style={{ marginTop: 12 }}>
                        <div
                          style={{
                            fontSize: 8,
                            color: c.text,
                            letterSpacing: 2,
                            textTransform: 'uppercase',
                            marginBottom: 6,
                          }}
                        >
                          💬 Descrição / Comentário
                        </div>
                        <textarea
                          value={
                            comments[
                              task.type === 'Frontend' ? 'frontend' : 'backend'
                            ]
                          }
                          onChange={(e) =>
                            updateComment(
                              task.type === 'Frontend' ? 'frontend' : 'backend',
                              e.target.value
                            )
                          }
                          placeholder={`Adicione um comentário ou contexto para a tarefa de ${task.type}...`}
                          rows={3}
                          style={{
                            width: '100%',
                            boxSizing: 'border-box',
                            background: '#060612',
                            border: `1px solid ${c.border}44`,
                            borderRadius: 6,
                            padding: '9px 11px',
                            color: '#c0c0d8',
                            fontSize: 11,
                            fontFamily: 'inherit',
                            resize: 'vertical',
                            outline: 'none',
                            lineHeight: 1.6,
                          }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Resumo Monday */}
      {status === STATUS.DONE && created.length > 0 && (
        <div
          style={{
            background: '#060e06',
            border: '1px solid #4ade8020',
            borderRadius: 8,
            padding: '13px',
          }}
        >
          <div
            style={{
              fontSize: 8,
              color: '#4ade80',
              letterSpacing: 2,
              textTransform: 'uppercase',
              marginBottom: 9,
            }}
          >
            ✓ Itens criados no Monday
          </div>
          {created.map((item, i) => {
            const c = COLORS[item.type];
            return (
              <div
                key={i}
                style={{
                  fontSize: 10,
                  color: c ? c.text : '#9999b8',
                  marginBottom: 4,
                  paddingLeft: item.type === 'epic' ? 0 : 12,
                  display: 'flex',
                  gap: 8,
                  alignItems: 'flex-start',
                }}
              >
                <span
                  style={{ color: c ? c.border : '#6366f1', flexShrink: 0 }}
                >
                  {item.type === 'epic' ? '◆' : '↳'}
                </span>
                <span>
                  {item.type !== 'epic' && (
                    <span style={{ opacity: 0.45 }}>[{item.type}] </span>
                  )}
                  {item.title}
                </span>
                {item.id && (
                  <span
                    style={{
                      color: '#222235',
                      marginLeft: 'auto',
                      flexShrink: 0,
                    }}
                  >
                    #{item.id}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Erro */}
      {error && (
        <div
          style={{
            background: '#130708',
            border: '1px solid #f8717125',
            borderRadius: 8,
            padding: '11px 13px',
            fontSize: 11,
            color: '#f87171',
          }}
        >
          ✕ {error}
        </div>
      )}

      <style>{`
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
        input:focus{border-color:#6366f1!important;box-shadow:0 0 0 2px #6366f115}
        ::-webkit-scrollbar{width:3px}
        ::-webkit-scrollbar-thumb{background:#1a1a2e;border-radius:2px}
      `}</style>
    </div>
  );
}
