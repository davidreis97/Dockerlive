# Dockerlive

Live programming environment for Dockerfiles.

## DISCLAIMER

This is an early version which is still under development. As such, some features may be unstable.

Developed within the scope of the final thesis of a MSc in Informatics and Computer Engineering.

## REQUREMENTS

- [Docker Engine](https://www.docker.com/) (>= v19.03.0)
- [Nmap](https://nmap.org/)

Nmap is optional. If present in the system, the extension can perform automatic service discovery on the test container.

## FEATURES

Automatically build, run, perform tests and provide feedback during the creation of a Dockerfile.

Feedback generated:
- Image build errors
- Container runtime errors
- Changes to environment variables
- Container running processes
- Container performance statistics (CPU, Memory, Network, I/O)
- Base image OS information
- Layer size
- Layer build time
- Explore each layer's filesystem (highlighting the changes of each layer)
- Service discovery (with Nmap)

