import { useState, useRef, useEffect } from "react";

const MONDAY_MCP = "https://mcp.monday.com/mcp";

const STATUS = {
  IDLE:            "idle",
  READING_PDF:     "reading_pdf",
  GENERATING:      "generating",
  CREATING_MONDAY: "creating_monday",
  DONE:            "done",
  ERROR:           "error",
};

function safeParseJSON(raw: string) {
  const tries = [
    () => JSON.parse(raw.trim()),
    () => JSON.parse(raw.replace(/```(?:json)?\s*/gi,"").replace(/```/g,"").trim()),
    () => { const s=raw.indexOf("{"),e=raw.lastIndexOf("}"); if(s!==-1&&e>s) return JSON.parse(raw.slice(s,e+1)); throw 0; },
  ];
  for (const fn of tries) { try { const r=fn(); if(r) return r; } catch {} }
  return null;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve((reader.result as string).split(",")[1]);
    reader.onerror = () => reject(new Error("Falha ao ler o arquivo."));
    reader.readAsDataURL(file);
  });
}

function buildFallback() {
  return {
    epic: { title: "Implementação do Layout", description: "Desenvolvimento completo do layout com base no PDF fornecido." },
    frontend: {
      title: "Desenvolvimento do Layout Completo", type: "Frontend",
      explanation: "Implementar o layout completo conforme o PDF: estrutura de página, header, navegação, seções de conteúdo, componentes visuais, tipografia, espaçamentos, imagens e footer.",
      criteria: ["Todos os elementos visuais do PDF estão implementados", "Layout responsivo em mobile, tablet e desktop", "Tipografia, cores e espaçamentos seguem o protótipo", "Aprovado em revisão de UI contra o PDF original"],
      conclusion: "Layout completo implementado e validado contra o PDF em todos os breakpoints.",
    },
    backend: {
      title: "APIs e Integrações de Suporte ao Layout", type: "Backend",
      explanation: "Desenvolver os endpoints e integrações necessários para suportar o conteúdo dinâmico identificado no layout.",
      criteria: ["Endpoints retornam os dados esperados pelo frontend", "Tempo de resposta inferior a 300ms", "APIs documentadas com OpenAPI/Swagger"],
      conclusion: "APIs e integrações disponíveis, documentadas e integradas ao frontend.",
    },
    hasBackend: true,
  };
}

async function callClaude(system: any, messages: any, mcpServers: any[] = [], maxTokens = 5000, apiKey = "") {
  const body: any = { model:"claude-sonnet-4-20250514", max_tokens:maxTokens, system, messages };
  if (mcpServers.length) body.mcp_servers = mcpServers;
  const res = await fetch("/api/anthropic/v1/messages", {
    method:"POST",
    headers:{ "Content-Type":"application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body:JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

const getText = (d: any) => (d.content||[]).filter((b: any)=>b.type==="text").map((b: any)=>b.text).join("\n");

// ── Design tokens ────────────────────────────────────────────────────────────
const BLUE       = "#2196F3";
const BLUE_DARK  = "#1976D2";
const BLUE_LIGHT = "#E3F2FD";
const GREEN      = "#43A047";
const RED        = "#D32F2F";
const RED_LIGHT  = "#FFEBEE";
const BORDER     = "#E0E0E0";
const BG         = "#F5F6FA";
const WHITE      = "#FFFFFF";
const TEXT       = "#212121";
const TEXT_MUTED = "#757575";
const TEXT_LIGHT = "#9E9E9E";

// ── Reusable card wrapper ────────────────────────────────────────────────────
function Card({ header, headerColor = BLUE, children }: { header: React.ReactNode; headerColor?: string; children: React.ReactNode }) {
  return (
    <div style={{ background:WHITE, borderRadius:8, border:`1px solid ${BORDER}`, overflow:"hidden", marginBottom:20 }}>
      <div style={{ background:headerColor, padding:"13px 20px", display:"flex", alignItems:"center", gap:10 }}>
        {header}
      </div>
      <div style={{ padding:"20px" }}>
        {children}
      </div>
    </div>
  );
}

function CardTitle({ children }: { children: React.ReactNode }) {
  return <span style={{ fontSize:12, fontWeight:700, color:"#fff", letterSpacing:.5, textTransform:"uppercase" }}>{children}</span>;
}

// ── Form field ───────────────────────────────────────────────────────────────
const labelStyle: React.CSSProperties = {
  display:"block", fontSize:12, fontWeight:600, color:TEXT_MUTED,
  marginBottom:6, letterSpacing:.3, textTransform:"uppercase",
};

const inputBase: React.CSSProperties = {
  width:"100%", boxSizing:"border-box",
  border:`1px solid ${BORDER}`, borderRadius:4,
  padding:"9px 12px", fontSize:13, color:TEXT,
  background:WHITE, fontFamily:"inherit", outline:"none",
  transition:"border-color .15s, box-shadow .15s",
};

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom:16 }}>
      <label style={labelStyle}>{label}</label>
      {children}
      {hint && <div style={{ fontSize:11, color:TEXT_LIGHT, marginTop:4 }}>{hint}</div>}
    </div>
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const [f, setF] = useState(false);
  return <input {...props}
    style={{ ...inputBase, borderColor:f?BLUE:BORDER, boxShadow:f?`0 0 0 3px ${BLUE}18`:"none", ...props.style }}
    onFocus={e=>{setF(true);props.onFocus?.(e);}}
    onBlur={e=>{setF(false);props.onBlur?.(e);}}/>;
}

function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const [f, setF] = useState(false);
  return <textarea {...props}
    style={{ ...inputBase, resize:"vertical", lineHeight:1.65, ...props.style, borderColor:f?BLUE:BORDER, boxShadow:f?`0 0 0 3px ${BLUE}18`:"none" }}
    onFocus={e=>{setF(true);props.onFocus?.(e);}}
    onBlur={e=>{setF(false);props.onBlur?.(e);}}/>;
}

// ── Step bar ─────────────────────────────────────────────────────────────────
const STEPS = [
  { key:STATUS.READING_PDF,     label:"Análise PDF"      },
  { key:STATUS.GENERATING,      label:"Geração de Tarefas" },
  { key:STATUS.CREATING_MONDAY, label:"Criação Monday"   },
  { key:STATUS.DONE,            label:"Concluído"         },
];

function StepBar({ status }: { status: string }) {
  const order = STEPS.map(s=>s.key);
  const cur = order.indexOf(status);
  return (
    <div style={{ display:"flex", gap:6, marginBottom:20 }}>
      {STEPS.map((s,i) => {
        const done = cur>i || status===STATUS.DONE;
        const act  = order[cur]===s.key;
        return (
          <div key={s.key} style={{ flex:1, display:"flex", flexDirection:"column", gap:5, alignItems:"center" }}>
            <div style={{ width:"100%", height:3, borderRadius:2, background:done?GREEN:act?BLUE:BORDER, transition:"background .3s" }}/>
            <span style={{ fontSize:9, color:done?GREEN:act?BLUE:TEXT_LIGHT, letterSpacing:.5, textAlign:"center" }}>{done?"✓ ":""}{s.label}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Log panel ─────────────────────────────────────────────────────────────────
function LogPanel({ log }: { log: any[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if(ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [log]);
  return (
    <Card header={<CardTitle>Log de execução</CardTitle>} headerColor="#37474F">
      <div ref={ref} style={{ maxHeight:155, overflowY:"auto", fontFamily:"'Fira Code','Cascadia Code',monospace", margin:"-4px 0" }}>
        {log.map((e,i) => (
          <div key={i} style={{ fontSize:11, marginBottom:4, display:"flex", gap:10 }}>
            <span style={{ color:TEXT_LIGHT, flexShrink:0 }}>[{e.ts}]</span>
            <span style={{ color:e.type==="success"?GREEN:e.type==="error"?RED:e.type==="warn"?"#F57C00":TEXT_MUTED }}>{e.msg}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ── Task accordion card ───────────────────────────────────────────────────────
function TaskCard({ task, commentVal, onComment }: { task:any; commentVal:string; onComment:(v:string)=>void }) {
  const [open, setOpen] = useState(false);
  const fe = task.type === "Frontend";
  const accent = fe ? GREEN : BLUE;

  return (
    <div style={{
      border:`1px solid ${open ? accent+"60" : BORDER}`,
      borderLeft:`3px solid ${accent}`,
      borderRadius:6, overflow:"hidden", marginBottom:8,
      background:WHITE, transition:"border-color .2s",
    }}>
      <div
        onClick={() => setOpen(o=>!o)}
        style={{
          padding:"12px 16px", cursor:"pointer",
          display:"flex", alignItems:"center", justifyContent:"space-between", gap:10,
          background: open ? (fe?"#F1F8F1":BLUE_LIGHT) : WHITE,
        }}
      >
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <span style={{
            fontSize:10, fontWeight:700, padding:"2px 9px", borderRadius:3,
            background: fe?"#E8F5E9":BLUE_LIGHT,
            color: fe?"#2E7D32":BLUE_DARK,
            textTransform:"uppercase", letterSpacing:.5,
          }}>{task.type}</span>
          <span style={{ fontSize:13, color:TEXT, fontWeight:600 }}>{task.title}</span>
        </div>
        <span style={{ color:accent, fontSize:16, display:"inline-block", transform:open?"rotate(90deg)":"none", transition:"transform .2s", flexShrink:0 }}>›</span>
      </div>

      {open && (
        <div style={{ padding:"0 16px 16px", borderTop:`1px solid ${BORDER}` }}>
          {[
            { title:"Explicação",          content: <div style={{ fontSize:12.5, color:TEXT, lineHeight:1.75, background:BG, borderRadius:4, padding:"10px 12px" }}>{task.explanation}</div> },
            { title:"Critérios de Aceite", content: (
              <div style={{ background:BG, borderRadius:4, padding:"10px 12px" }}>
                {(task.criteria||[]).map((cr:string,j:number) => (
                  <div key={j} style={{ display:"flex", gap:8, marginBottom:j<task.criteria.length-1?7:0, alignItems:"flex-start" }}>
                    <span style={{ color:accent, fontSize:10, marginTop:3, flexShrink:0 }}>◆</span>
                    <span style={{ fontSize:12.5, color:TEXT, lineHeight:1.6 }}>{cr}</span>
                  </div>
                ))}
              </div>
            )},
            { title:"Conclusão", content: <div style={{ fontSize:12.5, color:TEXT, lineHeight:1.75, background:BG, borderRadius:4, padding:"10px 12px", borderLeft:`3px solid ${accent}` }}>{task.conclusion}</div> },
          ].map(sec => (
            <div key={sec.title} style={{ marginTop:14 }}>
              <div style={{ fontSize:11, fontWeight:700, color:TEXT_MUTED, letterSpacing:.5, textTransform:"uppercase", marginBottom:6 }}>{sec.title}</div>
              {sec.content}
            </div>
          ))}
          <div style={{ marginTop:14 }}>
            <div style={{ fontSize:11, fontWeight:700, color:TEXT_MUTED, letterSpacing:.5, textTransform:"uppercase", marginBottom:6 }}>Comentário / Contexto</div>
            <Textarea value={commentVal} onChange={e=>onComment(e.target.value)}
              placeholder={`Adicione contexto para a tarefa de ${task.type}...`} rows={3}/>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function ProtoTaskAI() {
  const [pdfFile,   setPdfFile]   = useState<File|null>(null);
  const [pdfName,   setPdfName]   = useState("");
  const [boardName, setBoardName] = useState("Tarefas - PIlar de Atração");
  const [apiKey,    setApiKey]    = useState("");
  const [status,    setStatus]    = useState(STATUS.IDLE);
  const [log,       setLog]       = useState<any[]>([]);
  const [tasks,     setTasks]     = useState<any>(null);
  const [error,     setError]     = useState<string|null>(null);
  const [created,   setCreated]   = useState<any[]>([]);
  const [dragging,  setDragging]  = useState(false);
  const [comments,  setComments]  = useState({ epic:"", frontend:"", backend:"" });
  const fileRef = useRef<HTMLInputElement>(null);

  const updateComment = (key:string, val:string) => setComments(p=>({...p,[key]:val}));
  const addLog = (msg:string, type="info") =>
    setLog(p=>[...p,{msg,type,ts:new Date().toLocaleTimeString("pt-BR")}]);

  function handleFile(file:File|undefined) {
    if (!file||file.type!=="application/pdf") { setError("Envie um arquivo PDF válido."); return; }
    if (file.size>20*1024*1024) { setError("Arquivo muito grande. Limite: 20MB."); return; }
    setError(null); setPdfFile(file); setPdfName(file.name);
  }

  function onDrop(e:React.DragEvent) { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files[0]); }

  async function run() {
    if (!pdfFile) { setError("Selecione um arquivo PDF primeiro."); return; }
    if (!apiKey)  { setError("Informe sua Anthropic API Key."); return; }
    setStatus(STATUS.READING_PDF);
    setLog([]); setTasks(null); setError(null); setCreated([]); setComments({epic:"",frontend:"",backend:""});

    try {
      addLog("📄 Carregando PDF...");
      const base64 = await fileToBase64(pdfFile);
      addLog(`✅ PDF carregado (${(pdfFile.size/1024).toFixed(0)} KB)`,"success");
      addLog("🔍 Analisando layout...");

      const analysisData = await callClaude(
        "Você é especialista em análise de layouts. Descreva todos os elementos de UI do PDF e se há necessidade de backend.",
        [{role:"user",content:[
          {type:"document",source:{type:"base64",media_type:"application/pdf",data:base64}},
          {type:"text",text:"Analise este PDF: 1) elementos visuais, 2) necessidade de backend."},
        ]}],
        [],4000,apiKey
      );
      const layoutDescription = getText(analysisData);
      addLog(`✅ Layout analisado (${layoutDescription.length} chars)`,"success");

      setStatus(STATUS.GENERATING);
      addLog("🧠 Gerando tarefas...");

      const taskData = await callClaude(
        `Tech Lead sênior. Gere: 1 tarefa Frontend + 1 Backend (só se necessário). RETORNE SOMENTE JSON VÁLIDO.

Com backend: {"epic":{"title":"string","description":"string"},"frontend":{"title":"string","type":"Frontend","explanation":"string","criteria":["string"],"conclusion":"string"},"backend":{"title":"string","type":"Backend","explanation":"string","criteria":["string"],"conclusion":"string"},"hasBackend":true}
Sem backend: {"epic":{"title":"string","description":"string"},"frontend":{"title":"string","type":"Frontend","explanation":"string","criteria":["string"],"conclusion":"string"},"hasBackend":false}`,
        [{role:"user",content:`LAYOUT:\n\n${layoutDescription}\n\nGere o JSON.`}],
        [],4000,apiKey
      );

      const raw = getText(taskData);
      let parsed = safeParseJSON(raw);
      if (!parsed||!parsed.frontend) { addLog("⚠️ Usando fallback","warn"); parsed=buildFallback(); }
      setTasks(parsed);
      addLog(`✅ 1 tarefa Frontend${parsed.hasBackend?" + 1 tarefa Backend":" (sem Backend)"}`,"success");

      setStatus(STATUS.CREATING_MONDAY);
      addLog("📋 Buscando board no Monday...");

      const boardData = await callClaude(
        "Gerencie o Monday.com via MCP. Retorne SOMENTE JSON.",
        [{role:"user",content:`Busque o board "${boardName}". Retorne: {"boardId":"string"}`}],
        [{type:"url",url:MONDAY_MCP,name:"monday"}],2000,apiKey
      );
      const bText=getText(boardData);
      const bMatch=bText.match(/"boardId"\s*:\s*"?(\d+)"?/)||bText.match(/\b(\d{7,})\b/);
      const boardId=bMatch?bMatch[1]:null;
      if (!boardId) throw new Error(`Board "${boardName}" não encontrado.`);
      addLog(`✅ Board encontrado #${boardId}`,"success");

      addLog("🚀 Criando Epic...");
      const epicRes = await callClaude(
        "Gerencie o Monday.com via MCP.",
        [{role:"user",content:`Crie item no board ${boardId} com título "[EPIC] ${parsed.epic.title}". Descrição: "${comments.epic||parsed.epic.description}". Retorne {"itemId":"string"}`}],
        [{type:"url",url:MONDAY_MCP,name:"monday"}],2000,apiKey
      );
      const eText=getText(epicRes);
      const eMatch=eText.match(/"itemId"\s*:\s*"?(\d+)"?/)||eText.match(/\b(\d{7,})\b/);
      const epicId=eMatch?eMatch[1]:null;
      const createdList:any[]=[{type:"epic",title:parsed.epic.title,id:epicId}];
      addLog(`✅ Epic criado${epicId?` #${epicId}`:""}`,"success");

      const tasksToCreate=[parsed.frontend,...(parsed.hasBackend&&parsed.backend?[parsed.backend]:[])];
      const SUBITEM_BOARD_ID=18391805297;
      const SUBITEM_TEXT_COL="text_mm34w7h0";

      for (const task of tasksToCreate) {
        try {
          const ck=task.type==="Frontend"?"frontend":"backend";
          const uc=comments[ck as keyof typeof comments]||"";
          const tv=(uc||task.explanation).replace(/"/g,"'").split("\n").join(" ");
          const cv=JSON.stringify({[SUBITEM_TEXT_COL]:tv});
          const p=epicId
            ?`Use create_item: boardId=${SUBITEM_BOARD_ID}, parentItemId=${epicId}, name="[${task.type}] ${task.title}", columnValues=${cv}. Retorne {"itemId":"string"}`
            :`Use create_item: boardId=${boardId}, name="[${task.type}] ${task.title}", columnValues={}. Retorne {"itemId":"string"}`;
          const r=await callClaude("Gerencie o Monday.com via MCP.",[{role:"user",content:p}],[{type:"url",url:MONDAY_MCP,name:"monday"}],2000,apiKey);
          const rt=getText(r);
          const idM=rt.match(/"itemId"\s*:\s*"?(\d+)"?/)||rt.match(/(\d{7,})/);
          const newId=idM?idM[1]:null;
          createdList.push({type:task.type,title:task.title,id:newId});
          addLog(`  ↳ [${task.type}] ${task.title}`,"success");
          if (newId) {
            try {
              await callClaude("Gerencie o Monday.com via MCP.",
                [{role:"user",content:`Use change_item_column_values: boardId=${SUBITEM_BOARD_ID}, itemId=${newId}, columnValues={"${SUBITEM_TEXT_COL}":"${tv}"}`}],
                [{type:"url",url:MONDAY_MCP,name:"monday"}],2000,apiKey);
              addLog(`     ✔ Coluna "Texto" preenchida`,"success");
            } catch { addLog(`     ⚠️ Coluna "Texto" não preenchida`,"warn"); }
          }
        } catch { addLog(`  ⚠️ Erro ao criar: ${task.title}`,"warn"); }
      }

      setCreated(createdList);
      setStatus(STATUS.DONE);
      addLog(`🎉 Concluído! ${createdList.length} itens criados.`,"success");

    } catch(err:any) {
      setError(err.message); setStatus(STATUS.ERROR); addLog(`❌ ${err.message}`,"error");
    }
  }

  const isRunning=[STATUS.READING_PDF,STATUS.GENERATING,STATUS.CREATING_MONDAY].includes(status);
  const displayTasks=tasks?[tasks.frontend,...(tasks.hasBackend&&tasks.backend?[tasks.backend]:[])].filter(Boolean):[];
  const canRun=!isRunning&&!!pdfFile&&!!boardName&&!!apiKey;

  return (
    <div style={{ minHeight:"100vh", background:BG, fontFamily:"'Segoe UI','Helvetica Neue',sans-serif", color:TEXT, padding:"32px 16px 60px" }}>
      <div style={{ maxWidth:560, margin:"0 auto" }}>

        {/* APP HEADER */}
        <div style={{ background:WHITE, borderRadius:8, border:`1px solid ${BORDER}`, overflow:"hidden", marginBottom:24 }}>
          <div style={{ background:BLUE, padding:"16px 20px", display:"flex", alignItems:"center", gap:12 }}>
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
              <rect width="32" height="32" rx="7" fill="rgba(255,255,255,0.18)"/>
              <rect x="7" y="9"  width="12" height="3.5" rx="1.75" fill="#fff" opacity="0.95"/>
              <rect x="7" y="14.5" width="18" height="3.5" rx="1.75" fill="#fff" opacity="0.65"/>
              <rect x="7" y="20" width="9"  height="3.5" rx="1.75" fill="#fff" opacity="0.45"/>
            </svg>
            <div>
              <div style={{ fontSize:16, fontWeight:700, color:"#fff" }}>ProtoTask AI</div>
              <div style={{ fontSize:11, color:"rgba(255,255,255,0.75)", marginTop:1 }}>PDF → Tarefas Técnicas → Monday.com</div>
            </div>
            <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:7, background:"rgba(255,255,255,0.18)", borderRadius:20, padding:"5px 12px" }}>
              <span style={{
                width:7, height:7, borderRadius:"50%", display:"inline-block", flexShrink:0,
                background: status===STATUS.DONE?"#A5D6A7":status===STATUS.ERROR?"#EF9A9A":isRunning?"#FFF176":"#fff",
                animation: isRunning?"pulse 1.2s ease-in-out infinite":"none",
              }}/>
              <span style={{ fontSize:10, color:"rgba(255,255,255,0.9)" }}>
                {status===STATUS.DONE?"Concluído":status===STATUS.ERROR?"Erro":isRunning?"Processando...":"Pronto"}
              </span>
            </div>
          </div>
        </div>

        {/* CONFIGURAÇÃO */}
        <Card header={<CardTitle>Configuração</CardTitle>}>
          <Field label="Anthropic API Key" hint="Obtenha em console.anthropic.com → API Keys">
            <Input type="password" value={apiKey} onChange={e=>setApiKey(e.target.value)} disabled={isRunning} placeholder="sk-ant-..."/>
          </Field>
          <Field label="Board do Monday.com">
            <Input value={boardName} onChange={e=>setBoardName(e.target.value)} disabled={isRunning} placeholder="Nome exato do board"/>
          </Field>
        </Card>

        {/* UPLOAD PDF */}
        <Card header={<CardTitle>Arquivo PDF do Layout</CardTitle>}>
          <div
            onClick={()=>!isRunning&&fileRef.current?.click()}
            onDragOver={e=>{e.preventDefault();setDragging(true);}}
            onDragLeave={()=>setDragging(false)}
            onDrop={onDrop}
            style={{
              border:`2px dashed ${dragging?BLUE:pdfFile?GREEN:BORDER}`,
              borderRadius:6, padding:"28px 20px", textAlign:"center",
              cursor:isRunning?"not-allowed":"pointer",
              background:dragging?BLUE_LIGHT:pdfFile?"#F1F8F1":BG,
              transition:"all .2s",
            }}
          >
            {pdfFile ? (
              <div>
                <div style={{fontSize:28,marginBottom:6}}>📄</div>
                <div style={{fontSize:13,color:GREEN,fontWeight:700}}>{pdfName}</div>
                <div style={{fontSize:11,color:TEXT_LIGHT,marginTop:4}}>{(pdfFile.size/1024).toFixed(0)} KB · clique para trocar</div>
              </div>
            ) : (
              <div>
                <div style={{fontSize:30,marginBottom:8,color:TEXT_LIGHT}}>⬆</div>
                <div style={{fontSize:13,color:TEXT_MUTED}}>
                  Arraste o PDF aqui ou <span style={{color:BLUE,fontWeight:600}}>clique para selecionar</span>
                </div>
                <div style={{fontSize:11,color:TEXT_LIGHT,marginTop:5}}>Figma, Zeplin ou qualquer ferramenta · máx 20MB</div>
              </div>
            )}
          </div>
          <input ref={fileRef} type="file" accept="application/pdf" style={{display:"none"}}
            onChange={e=>handleFile(e.target.files?.[0])}/>
        </Card>

        {/* BOTÃO */}
        <button
          onClick={run} disabled={!canRun}
          style={{
            width:"100%", padding:"12px 0", marginBottom:24,
            background:canRun?BLUE:BORDER, border:"none", borderRadius:6,
            color:canRun?"#fff":TEXT_LIGHT, fontSize:13, fontFamily:"inherit",
            fontWeight:700, letterSpacing:1, textTransform:"uppercase",
            cursor:canRun?"pointer":"not-allowed",
            boxShadow:canRun?`0 2px 8px ${BLUE}50`:"none",
            transition:"background .2s",
          }}
          onMouseOver={e=>{if(canRun)(e.target as HTMLElement).style.background=BLUE_DARK;}}
          onMouseOut={e=>{if(canRun)(e.target as HTMLElement).style.background=BLUE;}}
        >
          {isRunning?"⟳  Processando...":status===STATUS.DONE?"↻  Rodar Novamente":"▶  Executar ProtoTask"}
        </button>

        {/* STEPS */}
        {status!==STATUS.IDLE && <StepBar status={status}/>}

        {/* LOG */}
        {log.length>0 && <LogPanel log={log}/>}

        {/* TAREFAS */}
        {tasks && (
          <div>
            <Card header={<CardTitle>Epic</CardTitle>} headerColor="#546E7A">
              <div style={{fontSize:15,fontWeight:700,color:TEXT,marginBottom:6}}>{tasks.epic?.title}</div>
              <div style={{fontSize:12.5,color:TEXT_MUTED,lineHeight:1.7,marginBottom:16}}>{tasks.epic?.description}</div>
              <Field label="Comentário / Contexto">
                <Textarea value={comments.epic} onChange={e=>updateComment("epic",e.target.value)}
                  placeholder="Adicione um comentário ou contexto para o Epic..." rows={3}/>
              </Field>
            </Card>

            <div style={{fontSize:11,color:TEXT_LIGHT,marginBottom:10,display:"flex",gap:14}}>
              <span style={{display:"flex",alignItems:"center",gap:5}}>
                <span style={{width:8,height:8,borderRadius:2,background:GREEN,display:"inline-block"}}/>Frontend
              </span>
              {tasks.hasBackend
                ? <span style={{display:"flex",alignItems:"center",gap:5}}>
                    <span style={{width:8,height:8,borderRadius:2,background:BLUE,display:"inline-block"}}/>Backend
                  </span>
                : <span style={{color:BORDER}}>— sem Backend necessário</span>
              }
            </div>

            {displayTasks.map((task:any,i:number) => (
              <TaskCard key={i} task={task}
                commentVal={comments[task.type==="Frontend"?"frontend":"backend" as keyof typeof comments]}
                onComment={v=>updateComment(task.type==="Frontend"?"frontend":"backend",v)}/>
            ))}
          </div>
        )}

        {/* MONDAY SUMMARY */}
        {status===STATUS.DONE && created.length>0 && (
          <Card header={<CardTitle>✓ Itens criados no Monday</CardTitle>} headerColor={GREEN}>
            {created.map((item,i) => {
              const isEpic=item.type==="epic";
              const color=item.type==="Frontend"?GREEN:item.type==="Backend"?BLUE:"#546E7A";
              return (
                <div key={i} style={{fontSize:12,color:TEXT,marginBottom:6,paddingLeft:isEpic?0:16,display:"flex",gap:8,alignItems:"center"}}>
                  <span style={{color,flexShrink:0}}>{isEpic?"◆":"↳"}</span>
                  <span>{!isEpic&&<span style={{color:TEXT_LIGHT}}>[{item.type}] </span>}{item.title}</span>
                  {item.id&&<span style={{color:TEXT_LIGHT,marginLeft:"auto",fontSize:11}}>#{item.id}</span>}
                </div>
              );
            })}
          </Card>
        )}

        {/* ERRO */}
        {error && (
          <div style={{background:RED_LIGHT,border:`1px solid #FFCDD2`,borderLeft:`3px solid ${RED}`,borderRadius:6,padding:"12px 14px",fontSize:12.5,color:RED,display:"flex",gap:10}}>
            <span style={{flexShrink:0}}>✕</span><span>{error}</span>
          </div>
        )}

      </div>
      <style>{`
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
        *{box-sizing:border-box}
        ::-webkit-scrollbar{width:4px}
        ::-webkit-scrollbar-thumb{background:#BDBDBD;border-radius:2px}
      `}</style>
    </div>
  );
}
