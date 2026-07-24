import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { OfficeCanvas } from '@/components/OfficeCanvas'
import { OfficeBottomToolbar, OfficeHeaderStats, OfficeProjectsModal, OfficeRightPanel, OfficeSidebar } from '@/components/OfficeDashboardChrome'
import { OfficeMeetingRoom } from '@/components/OfficeMeetingRoom'
import { OfficePlantModal } from '@/components/OfficePlantModal'
import type { ChatMsg } from '@/lib/meetingEngine'
import './App.css'

function App() {
  const [activeNav, setActiveNav] = useState('办公室')
  const [showProjects, setShowProjects] = useState(false)
  const [showMeeting, setShowMeeting] = useState(false)
  const [meetingKey, setMeetingKey] = useState(0)
  const [meetingInitial, setMeetingInitial] = useState<{
    topic?: string
    purpose?: string
    invited?: string[]
    messages?: ChatMsg[]
    planDoc?: string
    step?: 'setup' | 'discuss' | 'plan' | 'done'
  } | undefined>(undefined)
  const [plantModal, setPlantModal] = useState<{ open: boolean; text: string }>({ open: false, text: '' })

  const handleNavChange = (label: string) => {
    setActiveNav(label)
    if (label === '项目') {
      setShowProjects(true)
      return
    }
    if (label === '会议室') {
      setMeetingInitial(undefined)
      setMeetingKey((k) => k + 1)
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
    const open = () => {
      setMeetingInitial(undefined)
      setMeetingKey((k) => k + 1)
      setShowMeeting(true)
    }
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

  // 会议室执行完成后 → 打开项目看板
  useEffect(() => {
    const open = () => setShowProjects(true)
    window.addEventListener('office:open-projects', open)
    return () => window.removeEventListener('office:open-projects', open)
  }, [])

  // 从项目看板「返回会议室」→ 用快照恢复上下文并重新打开会议室
  useEffect(() => {
    const restore = (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        topic?: string
        purpose?: string
        invited?: string[]
        messages?: ChatMsg[]
        planDoc?: string
        step?: 'setup' | 'discuss' | 'plan' | 'done'
      }
      setMeetingInitial(detail)
      setMeetingKey((k) => k + 1)
      setShowProjects(false)
      setShowMeeting(true)
    }
    window.addEventListener('office:restore-meeting', restore)
    return () => window.removeEventListener('office:restore-meeting', restore)
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
      {showMeeting && createPortal(
        <OfficeMeetingRoom
          key={meetingKey}
          onClose={() => { setShowMeeting(false); setMeetingInitial(undefined) }}
          initialMeeting={meetingInitial}
        />,
        document.body,
      )}
      {showProjects && createPortal(
        <OfficeProjectsModal onClose={() => setShowProjects(false)} backToMeeting={showMeeting} />,
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
