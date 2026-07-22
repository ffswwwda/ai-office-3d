import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { OfficeCanvas } from '@/components/OfficeCanvas'
import { OfficeBottomToolbar, OfficeHeaderStats, OfficeProjectsModal, OfficeRightPanel, OfficeSidebar } from '@/components/OfficeDashboardChrome'
import { OfficeMeetingRoom } from '@/components/OfficeMeetingRoom'
import { OfficePlantModal } from '@/components/OfficePlantModal'
import './App.css'

function App() {
  const [activeNav, setActiveNav] = useState('办公室')
  const [showProjects, setShowProjects] = useState(false)
  const [showMeeting, setShowMeeting] = useState(false)
  const [plantModal, setPlantModal] = useState<{ open: boolean; text: string }>({ open: false, text: '' })

  const handleNavChange = (label: string) => {
    setActiveNav(label)
    if (label === '项目') {
      setShowProjects(true)
      return
    }
    if (label === '会议室') {
      setShowMeeting(true)
      return
    }
    if (label !== '办公室') {
      window.dispatchEvent(new CustomEvent('office:nav', { detail: { label } }))
    }
  }

  const handleAgentClick = (agentId: string) => {
    window.dispatchEvent(new CustomEvent('office:agent-click', { detail: { agentId } }))
  }

  // 3D 场景里点击「会议室」桌子 → 打开会议室
  useEffect(() => {
    const open = () => setShowMeeting(true)
    window.addEventListener('office:open-meeting', open)
    return () => window.removeEventListener('office:open-meeting', open)
  }, [])

  // 点击场景里的绿植 → 弹出植物说明
  useEffect(() => {
    const onPlant = (e: Event) => {
      const detail = (e as CustomEvent).detail
      setPlantModal({ open: true, text: detail?.text || '' })
    }
    window.addEventListener('office:plant-click', onPlant)
    return () => window.removeEventListener('office:plant-click', onPlant)
  }, [])

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
      {showMeeting && createPortal(
        <OfficeMeetingRoom onClose={() => setShowMeeting(false)} />,
        document.body,
      )}
      {plantModal.open && createPortal(
        <OfficePlantModal text={plantModal.text} onClose={() => setPlantModal({ ...plantModal, open: false })} />,
        document.body,
      )}
    </div>
  )
}

export default App
