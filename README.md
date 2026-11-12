# API ClimbeSoftRad

API NestJS com PostgreSQL para cadastro de unidades e médicos, recepção de estudos DICOM, laudos e devolução ao hospital.

O serviço está em `backend`. O arquivo `render.yaml` descreve a API e o PostgreSQL no Render; a criação dos recursos pagos requer confirmação do responsável. Instruções: [deploy no Render](docs/deploy-render.md).

```powershell
cd backend
npm ci
npm run keys:generate
# Configure seu .env a partir de .env.example.
npm run migration:run
npm start
```

O repositório não inclui chaves privadas, `.env`, banco de dados nem arquivos de pacientes. Os fronts, o PACS/visualizador e o gerador Windows do Router são componentes separados da publicação desta API.
