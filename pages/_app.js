import { useEffect } from 'react';
import ReactGA from 'react-ga4'

import '../styles/globals.css'
import 'bootstrap/dist/css/bootstrap.min.css'

function MyApp({ Component, pageProps }) {
  useEffect(() => {
    ReactGA.initialize('G-6RM9MTFN2Y');
    ReactGA.pageview(window.location.pathname + window.location.search);
  }, [])

  return <Component {...pageProps} />
}

export default MyApp
