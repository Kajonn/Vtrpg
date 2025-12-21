const ports = [];

self.onconnect = (event) => {
  const port = event.ports[0];
  ports.push(port);

  port.onmessage = (messageEvent) => {
    const data = messageEvent.data;
    ports.forEach((targetPort) => {
      if (targetPort !== port) {
        targetPort.postMessage(data);
      }
    });
  };
};
