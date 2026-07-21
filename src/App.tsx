import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { OfficeCanvas } from '@/components/OfficeCanvas'
import { OfficeBottomToolbar, OfficeHeaderStats, OfficeProjectsModal, OfficeRightPanel, OfficeSidebar } from '@/components/OfficeDashboardChrome'
import './App.css'

function App() {
  const [activeNav, setActiveNav] = useState('办公室')
  const [showProjects, setShowProjects] = useState(false)

  const handleNavChange = (label: string) => {
    setActiveNav(label)
    if (label === '项目') {
      setShowProjects(true)
      return
    }
    if (label !== '办公室') {
      window.dispatchEvent(new CustomEvent('office:nav', { detail: { label } }))
    }
  }

  const handleAgentClick = (agentId: string) => {
    window.dispatchEvent(new CustomEvent('office:agent-click', { detail: { agentId } }))
  }

  return (
    <div className="office-app">
      <OfficeSidebar onAgentClick={handleAgentClick} activeNav={activeNav} onNavChange={handleNavChange} />
      <div className="office-center">
        <OfficeHeaderStats />
        <main className="office-main">
          <OfficeCanvas />
          <OfficeBottomToolbar />
        </main>
      </div>
      <OfficeRightPanel />
      {showProjects && createPortal(
        <OfficeProjectsModal onClose={() => setShowProjects(false)} />,
        document.body,
      )}
    </div>
  )
}

export default App
