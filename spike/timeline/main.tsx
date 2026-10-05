import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import DndDemo from './DndDemo'
import VisDemo from './VisDemo'
import './spike.css'

const params = new URLSearchParams(location.search)
const page = params.get('lib') ?? 'dnd'
const rtl = params.get('rtl') === '1'

performance.mark('app-start')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <div>
      <header className="bar">
        <strong>Maestro timeline spike</strong> — {page} {rtl ? '(RTL)' : '(LTR)'} · 150 resources ·
        <a href="?lib=dnd"> dnd</a> · <a href="?lib=dnd&rtl=1">dnd-rtl</a> ·
        <a href="?lib=vis"> vis</a> · <a href="?lib=vis&rtl=1">vis-rtl</a>
      </header>
      {page === 'dnd' ? <DndDemo rtl={rtl} /> : <VisDemo rtl={rtl} />}
    </div>
  </StrictMode>,
)
