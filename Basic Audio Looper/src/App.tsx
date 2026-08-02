// import { useState } from 'react'
// import reactLogo from './assets/react.svg'
// import viteLogo from './assets/vite.svg'
// import heroImg from './assets/hero.png'
import './App.css'
import WebApp from './looperWebApp/WebApp'

function App() {

  return (
    <section className='appSection'>
      <h2 style={{marginBottom:"1.5rem"}}>Audio File Looper</h2>
      <WebApp/>
    </section>
  )
}

export default App
