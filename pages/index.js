import useAvailabilityMatcher from "@/lib/useAvailabilityMatcher"
import Head from "next/head"
import { useEffect, useCallback, useState } from "react"
import {useDropzone} from 'react-dropzone'
import ReactGA from "react-ga4"

import { Container, Col, Row, Button } from "react-bootstrap"

import Styles from './index.module.scss'

export default function Home() {
  // const { buildings, getClosestRooms, ready, error } = useAvailability()
  // const { setCalendarFromFile, getDayEvents, getWeekEvents, ready: calendarReady } = useCalendar()
  const { setCalendarFromFile, bestRoomSchedule, setFavorites, favorites, downloadSchedule, calReady, buildingsReady, pathsReady } = useAvailabilityMatcher()

  const onDrop = useCallback(async acceptedFiles => {
    setCalendarFromFile(acceptedFiles[0])
  }, [setCalendarFromFile])
  const {getRootProps, getInputProps, isDragActive} = useDropzone({
    onDrop,
    accept: '.ics',
    maxFiles: 1,
    multiple: false
  })

  const stopLinkOpenFileBrowser = useCallback(e => {
    // e.preventDefault()
    e.stopPropagation()
  }, [])

  const [favoriteString, _setFavoriteString] = useState('')
  const setFavoriteString = useCallback(s => {
    s = s.toUpperCase()
    _setFavoriteString(s)
    localStorage.setItem('favorites', s)
  }, [_setFavoriteString])
  useEffect(() => {
    const favorites = favoriteString.split(',').map(s => s.trim()).filter(s => s.length > 0).map(s => s.toUpperCase())
    setFavorites(favorites)
  }, [favoriteString, setFavorites])

  useEffect(() => {
    // When we start the app, we want to load the favorites from local storage
    const favorites = localStorage.getItem('favorites')
    if (favorites) {
      setFavoriteString(favorites)
    }
  }, [setFavoriteString])

  const _downloadSchedule = useCallback(() => {
    downloadSchedule()
    ReactGA.event({
      category: 'Schedule',
      action: 'Download'
    })
  }, [downloadSchedule])

  return (<>
    <Head>
      <title>Async Search</title>
    </Head>
    <Container fluid className={Styles.mainContainer}>
      <img src='/uoft.png' alt='UofT icon'/>

      <Row className={Styles.dropRow}>
        <Col></Col>
        <Col xs={10} md={8}>
          <div {...getRootProps()} className={Styles.dropContainer}>
            <input {...getInputProps()} />
            {
              isDragActive ?
                <p>Drop your coursesCalendar.ics here ...</p> :
                calReady ?
                  <p>Download coursesCalendar.ics from <a onClick={stopLinkOpenFileBrowser} rel="noreferrer" href='https://acorn.utoronto.ca/sws/rest/timetable/export-iCalEvents' target="_blank">Acorn</a> and drop or select it here to update your schedule</p> :
                  <p>Download coursesCalendar.ics from <a onClick={stopLinkOpenFileBrowser} rel="noreferrer" href='https://acorn.utoronto.ca/sws/rest/timetable/export-iCalEvents' target="_blank">Acorn</a> and drop or select it here</p>
            }
          </div>
        </Col>
        <Col></Col>
      </Row>

      <Button onClick={_downloadSchedule} disabled={!pathsReady}>Download Break Schedule</Button>

      <Row className={Styles.infoContainer}>
        <Col></Col>
        <Col xs={9} md={7}>
          <p>
            This app takes your schedule calendar and finds available rooms for you to go to during the breaks between classes. Instead of
            checking which rooms are available in which building every hour, this tool will tell you exactly which rooms are open for your
            entire break. And if there is not any room that is open the entire time, it tells you which rooms to move between.
          </p>
          <p>
            Only buildings with at least one room available for your entire break are considered. This means that if there is an hour where no
            room is available, that building will not be suggested. The rooms are suggested based on a scoring system that takes into account
            this distance from the previous class and to your next class as well as how many rooms you have to move between. This means that
            sometimes your favorite building will be scored low and not be suggested. To get around this, you can add your favorite buildings
            by typing their building code into the textbox below.
          </p>
          <span>
            <input value={favoriteString} onChange={e => setFavoriteString(e.target.value)} type='text' placeholder="MY, SS" />
            <p>Current Favorites: {favorites.join(', ')}</p>
          </span>
          <p>
            Also, if you are hesitant about sharing your personal schedule for whatever reason, schedules never leave your computer. They are
            stored in your browser to make the tool easier to use, but they are never sent to the server.
          </p>
          <p>
            Limitations: Unfortunately, the API I am using only allows you to get the schedule from today up until Friday at 8:00pm. This means
            you have to come back and create a new schedule every week. If there is interest, I can work around this, but at the moment it is not
            worth my time. The other limitation is that we only generate paths inside the same building. If you have a long break, it is likely
            that your favorite building will not have at least one room for an hour at some point. This means the building will not be suggested
            even if there is just one hour where no room is available. I could also improve the algorithm to work with these cases, but again, it
            is not worth my time atm.
          </p>
        </Col>
        <Col></Col>
      </Row>
    </Container>
    {/* <div className={Styles.mainContainer}>
      <img src='/uoft.png' />
    </div> */}
    {/* <div {...getRootProps()}>
      <input {...getInputProps()} />
      {
        isDragActive ?
          <p>Drop the files here ...</p> :
          <p>Drag &apos;n&apos; drop some files here, or click to select files</p>
      }
    </div>
    <button onClick={downloadSchedule}>Download Calendar</button> */}
  </>)
}
