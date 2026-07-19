import React, { useState, useRef, useEffect } from 'react';
import './App.css';

interface Option {
  code: string;
  text: string;
  route?: string;
}

interface Question {
  id: string;
  text: string;
  heading: string;
  coding: string;
  filter: string;
  options: Option[];
  source: 'paragraph' | 'table';
  isSection?: boolean;
  no: number;
  tableTitle: string;
  baseTitle: string;
  baseFilter: string;
  headerTitle: string;
  comment: string;
  remark: string;
  includeInTabSpec?: boolean; // frontend flag
  useAsBanner?: boolean; // frontend flag
}

export default function App() {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [fileName, setFileName] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'converter' | 'sandbox'>('converter');
  const [loading, setLoading] = useState<boolean>(false);
  const [dragActive, setDragActive] = useState<boolean>(false);
  const [selectedQuestionIdx, setSelectedQuestionIdx] = useState<number | null>(null);
  
  const [sandboxText, setSandboxText] = useState<string>(
    `RQ7. What is the highest level of education of the chief wage earner?\nASK ALL\nSINGLE CODING\n\nRQ12. Which precious metals did you buy in the last 12 months?\nMULTIPLE CODING, RANDOMIZE`
  );

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Seed the two grid checkboxes once per upload: everything is included in the AP,
  // and demographics are pre-ticked as banners since they are the usual cross-tabs.
  // Keyed on length so it re-runs on a new file but not on every cell edit; the
  // undefined checks below preserve any choice the user has already made.
  useEffect(() => {
    if (questions.length > 0) {
      setQuestions(prev =>
        prev.map(q => {
          if (q.isSection) return q;
          const lowerId = q.id.toLowerCase();
          const lowerTitle = q.tableTitle.toLowerCase();
          const isDemographic = 
            lowerId === 'rq1' || 
            lowerId === 'rq4' || 
            lowerId === 'rq5a' || 
            lowerId === 'rq7' || 
            lowerId === 'rq7a' || 
            lowerId === 'rq10' ||
            lowerTitle.includes('gender') || 
            lowerTitle.includes('city') || 
            lowerTitle.includes('age') || 
            lowerTitle.includes('education') || 
            lowerTitle.includes('occupation') ||
            lowerTitle.includes('nccs');
            
          return {
            ...q,
            includeInTabSpec: q.includeInTabSpec !== undefined ? q.includeInTabSpec : true,
            useAsBanner: q.useAsBanner !== undefined ? q.useAsBanner : isDemographic
          };
        })
      );
    }
  }, [questions.length]);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      await processFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      await processFile(e.target.files[0]);
    }
  };

  const triggerFileSelect = () => {
    fileInputRef.current?.click();
  };

  const processFile = async (file: File) => {
    if (!file.name.endsWith('.docx')) {
      alert('Please upload a valid Word document (.docx)');
      return;
    }

    setLoading(true);
    setFileName(file.name);
    
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/api/parse', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        throw new Error(await res.text());
      }

      const data = await res.json();
      setQuestions(data.questions || []);
    } catch (error: any) {
      console.error(error);
      alert('Failed to parse questionnaire: ' + error.message);
      setFileName('');
    } finally {
      setLoading(false);
    }
  };

  const updateQuestionField = (idx: number, field: keyof Question, value: any) => {
    setQuestions(prev => {
      const updated = [...prev];
      updated[idx] = { ...updated[idx], [field]: value };
      return updated;
    });
  };

  const handleGenerateExcel = async () => {
    if (questions.length === 0) return;

    setLoading(true);

    // Section rows are always exported; question rows only if ticked.
    const tabSpecRows = questions
      .filter(q => q.includeInTabSpec || q.isSection)
      .map((q) => ({
        no: q.isSection ? 0 : q.no,
        id: q.isSection ? '' : q.id,
        tableTitle: q.tableTitle,
        baseTitle: q.isSection ? '' : q.baseTitle,
        baseFilter: q.isSection ? '' : q.baseFilter,
        headerTitle: q.isSection ? '' : q.headerTitle,
        comment: q.isSection ? '' : q.comment,
        remark: q.remark || '',
        isSection: q.isSection || false
      }));

    // A banner needs options to become cross-tab columns, so optionless ones are dropped.
    const bannerRows = questions
      .filter(q => q.useAsBanner && !q.isSection && q.options && q.options.length > 0)
      .map(q => ({
        id: q.id,
        tableTitle: q.tableTitle,
        options: q.options.map(o => ({ code: o.code, text: o.text }))
      }));

    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tabSpec: tabSpecRows, banners: bannerRows })
      });

      if (!res.ok) {
        throw new Error(await res.text());
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName.replace('.docx', '_Analysis_Plan.xlsx');
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (error: any) {
      console.error(error);
      alert('Failed to generate Excel: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  // Mirrors the server's detection rules so the sandbox tab can preview matches
  // without a round trip. Kept deliberately simple; it is a teaching aid, not the parser.
  const parseSandboxText = () => {
    const lines = sandboxText.split('\n');
    const results: string[] = [];
    
    const qParaRegex = /^\s*([A-Z]+\d+[a-z]*)\.?\s+(.*)/i;
    const codingRegex = /(SINGLE\s+CODING|MULTIPLE\s+CODING|RECORD\s+VERBATIM|RANKING|GRID|SINGLE\s+MULTIPLE\s+CODING)/i;
    const filterRegex = /(ASK\s+ALL|ASK\s+THOSE\s+[^.]*|ASK\s+IF\s+[^.]*|FILTER\s*:?\s*[^.]*)/i;

    lines.forEach((line, idx) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      const qMatch = trimmed.match(qParaRegex);
      const codingMatch = trimmed.match(codingRegex);
      const filterMatch = trimmed.match(filterRegex);

      if (qMatch) {
        results.push(`Line ${idx + 1}: Found Question!\n  ID: ${qMatch[1].toUpperCase()}\n  Text: ${qMatch[2]}`);
      } else if (codingMatch) {
        results.push(`Line ${idx + 1}: Found Coding Instruction!\n  Type: ${codingMatch[1].toUpperCase()}`);
      } else if (filterMatch) {
        results.push(`Line ${idx + 1}: Found Filter Block!\n  Condition: ${filterMatch[1]}`);
      }
    });

    if (results.length === 0) {
      return "No matches found in test text. Write lines starting with question codes (e.g. 'RQ1. What is your city?') or instructions ('SINGLE CODING', 'ASK ALL').";
    }
    return results.join('\n\n');
  };

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="brand-section">
          <div className="logo-badge">AP</div>
          <div className="brand-title">Questionnaire <span>AP Converter</span></div>
        </div>
        
        <nav className="nav-tabs">
          <button 
            className={`tab-btn ${activeTab === 'converter' ? 'active' : ''}`}
            onClick={() => setActiveTab('converter')}
          >
            Converter
          </button>
          <button 
            className={`tab-btn ${activeTab === 'sandbox' ? 'active' : ''}`}
            onClick={() => setActiveTab('sandbox')}
          >
            Regex Sandbox
          </button>
        </nav>
      </header>

      {activeTab === 'converter' ? (
        questions.length === 0 ? (
          /* File Upload Landing Page */
          <div className="upload-view">
            <div className="upload-title-section">
              <h1>DOCX to XLS AP Converter</h1>
              <p>Extract questions, options, NCCS tables and build Analysis Plans instantly</p>
            </div>
            
            <div 
              className={`upload-card ${dragActive ? 'drag-active' : ''}`}
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
            >
              <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handleFileInputChange} 
                accept=".docx" 
                style={{ display: 'none' }} 
              />
              
              <div className="btn-upload-group" onClick={triggerFileSelect}>
                <button className="btn-primary-upload">Choose Files</button>
                <div className="upload-icons">
                  <svg className="upload-icon-svg" viewBox="0 0 24 24"><path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>
                  <svg className="upload-icon-svg" viewBox="0 0 24 24"><path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM19 18H6c-2.21 0-4-1.79-4-4 0-2.05 1.53-3.76 3.56-3.97l1.07-.11.5-.95C8.08 7.14 9.94 6 12 6c2.62 0 4.88 1.86 5.39 4.43l.3 1.5 1.53.11c1.56.1 2.78 1.41 2.78 3 0 1.65-1.35 3-3 3z"/></svg>
                </div>
              </div>
              
              <div className="upload-format-selector">
                <span className="upload-format-badge">DOCX</span>
                <span>to</span>
                <span className="upload-format-badge">XLS</span>
              </div>
              
              <div className="upload-subtext">
                Drop files here. 5 MB maximum file size or <span onClick={triggerFileSelect}>Browse file</span>
              </div>
            </div>
          </div>
        ) : (
          /* Questionnaire Interactive Editor */
          <div className="editor-workspace">
            <div className="editor-main">
              <div className="editor-toolbar">
                <div className="toolbar-info">
                  <span>File:</span>
                  <span className="file-pill">{fileName}</span>
                  <span style={{ color: 'var(--text-secondary)' }}>|</span>
                  <span>Parsed <strong>{questions.filter(q => !q.isSection).length}</strong> questions</span>
                </div>
                
                <div className="toolbar-actions">
                  <button className="btn-secondary" onClick={() => { setQuestions([]); setFileName(''); }}>
                    Upload Another
                  </button>
                  <button className="btn-action-red" onClick={handleGenerateExcel}>
                    Export to AP Excel
                  </button>
                </div>
              </div>

              <div className="table-container">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th style={{ width: '40px', textAlign: 'center' }}>AP</th>
                      <th style={{ width: '50px', textAlign: 'center' }}>Banner</th>
                      <th style={{ width: '70px', textAlign: 'center' }}>Seq</th>
                      <th style={{ width: '90px', textAlign: 'center' }}>ID</th>
                      <th style={{ width: '220px' }}>Table Title</th>
                      <th style={{ width: '120px' }}>Base</th>
                      <th style={{ width: '220px' }}>Base Filter</th>
                      <th style={{ width: '100px' }}>Metric</th>
                      <th style={{ width: '100px', textAlign: 'center' }}>Choices</th>
                    </tr>
                  </thead>
                  <tbody>
                    {questions.map((q, idx) => {
                      if (q.isSection) {
                        return (
                          <tr key={`sec-${idx}`} className="section-row">
                            <td colSpan={2}></td>
                            <td colSpan={7}>
                              <div className="section-input-wrapper">
                                <svg viewBox="0 0 24 24" width="18" height="18" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
                                <input 
                                  className="grid-input-title"
                                  style={{ fontWeight: 700, color: 'var(--color-accent)' }}
                                  type="text" 
                                  value={q.tableTitle} 
                                  onChange={(e) => updateQuestionField(idx, 'tableTitle', e.target.value)}
                                />
                              </div>
                            </td>
                          </tr>
                        );
                      }
                      
                      return (
                        <tr key={`q-${idx}`} className="row-question">
                          <td style={{ textAlign: 'center' }}>
                            <label className="custom-checkbox">
                              <input 
                                type="checkbox" 
                                checked={q.includeInTabSpec || false} 
                                onChange={(e) => updateQuestionField(idx, 'includeInTabSpec', e.target.checked)}
                              />
                              <span className="checkmark"></span>
                            </label>
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <label className="custom-checkbox">
                              <input 
                                type="checkbox" 
                                checked={q.useAsBanner || false} 
                                onChange={(e) => updateQuestionField(idx, 'useAsBanner', e.target.checked)}
                              />
                              <span className="checkmark"></span>
                            </label>
                          </td>
                          <td style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>
                            {q.no}
                          </td>
                          <td>
                            <input 
                              type="text" 
                              className="grid-input-id"
                              value={q.id}
                              onChange={(e) => updateQuestionField(idx, 'id', e.target.value)}
                            />
                          </td>
                          <td>
                            <input 
                              type="text" 
                              className="grid-input-title"
                              value={q.tableTitle}
                              onChange={(e) => updateQuestionField(idx, 'tableTitle', e.target.value)}
                            />
                          </td>
                          <td>
                            <input 
                              type="text" 
                              className="grid-input-filter"
                              value={q.baseTitle}
                              onChange={(e) => updateQuestionField(idx, 'baseTitle', e.target.value)}
                            />
                          </td>
                          <td>
                            <input 
                              type="text" 
                              className="grid-input-filter"
                              placeholder="No Filter"
                              value={q.baseFilter}
                              onChange={(e) => updateQuestionField(idx, 'baseFilter', e.target.value)}
                            />
                          </td>
                          <td>
                            <select 
                              className="grid-select-type"
                              value={q.comment}
                              onChange={(e) => updateQuestionField(idx, 'comment', e.target.value)}
                            >
                              <option value="%, Sum">%, Sum</option>
                              <option value="%, Mean">%, Mean</option>
                              <option value="Mean, Median">Mean, Median</option>
                              <option value="Sum">Sum</option>
                            </select>
                          </td>
                          <td style={{ display: 'flex', justifyContent: 'center' }}>
                            <button className="btn-options-toggle" onClick={() => setSelectedQuestionIdx(idx)}>
                              <span>View</span> 
                              <span style={{ opacity: 0.6 }}>({q.options ? q.options.length : 0})</span>
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <aside className="editor-sidebar">
              <div className="sidebar-section">
                <div className="sidebar-title">Banners / Headers</div>
                <div className="sidebar-card">
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
                    Select variables to include as cross-tabulation columns in the Header sheet:
                  </div>
                  <div className="banner-list">
                    {questions.filter(q => q.useAsBanner && !q.isSection).map((q, i) => (
                      <div key={`banner-${i}`} className="banner-item">
                        <span className="banner-name">{q.tableTitle}</span>
                        <span className="banner-code">{q.id}</span>
                      </div>
                    ))}
                    {questions.filter(q => q.useAsBanner && !q.isSection).length === 0 && (
                      <div style={{ color: 'var(--text-secondary)', fontStyle: 'italic', fontSize: '0.85rem' }}>
                        No banners selected. Check the "Banner" column in the table grid.
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="sidebar-section">
                <div className="sidebar-title">Template Presets</div>
                <div className="sidebar-card" style={{ gap: '0.5rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>AP Style:</span>
                    <span style={{ fontWeight: 600 }}>Goldline Default</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Sheets Auto-Created:</span>
                    <span>TabSpec, Header</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Sheets Copied:</span>
                    <span>Deliverables, Version...</span>
                  </div>
                </div>
              </div>
            </aside>
          </div>
        )
      ) : (
        /* Regex Sandbox Playground Tab */
        <div className="sandbox-view">
          <div className="sandbox-header">
            <h1>Regex Analyzer Sandbox</h1>
            <p>Test matching rules on sample questionnaire markup blocks in real-time</p>
          </div>
          
          <div className="sandbox-grid">
            <div className="sandbox-panel">
              <h3 className="sandbox-panel-title">1. Test Input Block</h3>
              <textarea 
                className="sandbox-textarea"
                value={sandboxText}
                onChange={(e) => setSandboxText(e.target.value)}
                placeholder="Paste code blocks here..."
              />
              
              <div className="regex-rule-card">
                <div className="regex-title">
                  <span>Question ID Detector</span>
                  <span className="tag">Regex</span>
                </div>
                <div className="regex-pattern">/^\s*([A-Z]+\d+[a-z]*)\.?\s+(.*)/i</div>
                <div className="regex-desc">Detects question identifiers like RQ1, RQ7a, C2. at paragraph lines.</div>
              </div>

              <div className="regex-rule-card">
                <div className="regex-title">
                  <span>Coding Instructions Detector</span>
                  <span className="tag">Regex</span>
                </div>
                <div className="regex-pattern">/(SINGLE|MULTIPLE)\s+CODING/i</div>
                <div className="regex-desc">Identifies single coding or multiple coding specifications.</div>
              </div>
            </div>

            <div className="sandbox-panel">
              <h3 className="sandbox-panel-title">2. Live Match Evaluation</h3>
              <div className="result-card">
                <div className="result-header">Token Matches</div>
                <pre className="result-body">{parseSandboxText()}</pre>
              </div>
            </div>
          </div>
        </div>
      )}

      {loading && (
        <div className="loading-overlay">
          <div className="spinner"></div>
          <div className="loading-text">Parsing Questionnaire & Compiling Data...</div>
        </div>
      )}

      {selectedQuestionIdx !== null && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h3 className="modal-title">
                Edit Options for {questions[selectedQuestionIdx].id}
              </h3>
              <button className="modal-close" onClick={() => setSelectedQuestionIdx(null)}>&times;</button>
            </div>
            
            <div className="modal-body">
              <div className="sidebar-title">Question Wording</div>
              <div className="question-text-block">
                {questions[selectedQuestionIdx].text}
              </div>
              
              <div className="sidebar-title">Option Codes & Labels</div>
              <div className="modal-options-list">
                {questions[selectedQuestionIdx].options && questions[selectedQuestionIdx].options.length > 0 ? (
                  questions[selectedQuestionIdx].options.map((opt, oIdx) => (
                    <div key={`opt-${oIdx}`} className="option-row-item">
                      <input 
                        type="text" 
                        className="option-code-input"
                        value={opt.code} 
                        onChange={(e) => {
                          const updatedOpts = [...questions[selectedQuestionIdx].options];
                          updatedOpts[oIdx].code = e.target.value;
                          updateQuestionField(selectedQuestionIdx, 'options', updatedOpts);
                        }}
                        placeholder="Code"
                      />
                      <input 
                        type="text" 
                        className="option-text-input"
                        value={opt.text} 
                        onChange={(e) => {
                          const updatedOpts = [...questions[selectedQuestionIdx].options];
                          updatedOpts[oIdx].text = e.target.value;
                          updateQuestionField(selectedQuestionIdx, 'options', updatedOpts);
                        }}
                        placeholder="Option label"
                      />
                    </div>
                  ))
                ) : (
                  <div style={{ color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                    No options found for this question (e.g. record verbatim / open ended).
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
