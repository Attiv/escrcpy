import service from './service.js'

export default {
  name: 'module:device-input',
  apply(mainApp) {
    mainApp.use(service)
  },
}
