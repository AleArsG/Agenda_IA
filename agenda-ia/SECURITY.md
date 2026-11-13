# Seguridad y cumplimiento

## Medidas implementadas (OWASP Top 10 2021)
| Riesgo | Medida en el proyecto |
|---|---|
| A01 Control de acceso | `/api/agent` solo acepta peticiones del mismo origen. No hay datos de otros usuarios: la agenda vive en el navegador de cada persona. |
| A02 Fallas criptográficas | Claves de API solo en variables de entorno del servidor; HTTPS y cabecera HSTS en producción. |
| A03 Inyección | Validación de tipo y largo de toda entrada; lista blanca de campos y tipos en lo que devuelve la IA; React escapa el contenido (sin `dangerouslySetInnerHTML`); no hay SQL. |
| A04 Diseño inseguro | Mínimo privilegio: el agente solo sugiere/crea eventos, no borra ni modifica. Límite de 20 peticiones/min por IP, mensaje ≤1000 caracteres, historial y estado acotados. |
| A05 Configuración | Cabeceras de seguridad (nosniff, X-Frame-Options, Referrer-Policy, Permissions-Policy, HSTS); `poweredByHeader` desactivado; `.env.example` sin secretos; `.env*` en `.gitignore`. |
| A06 Componentes vulnerables | Dependencias mínimas con versiones acotadas; ejecutar `npm audit` periódicamente. |
| A07 Autenticación | Sin cuentas ni contraseñas (limitación conocida; mejora futura: login). |
| A08 Integridad | La salida de la IA nunca se aplica directamente: se sanea y valida antes de llegar al calendario. Subir `package-lock.json`. |
| A09 Registro y monitoreo | Errores controlados con mensajes genéricos (sin claves ni detalles internos). Mejora futura: logs centralizados. |
| A10 SSRF | El servidor solo llama a hosts fijos de proveedores de IA; el usuario no controla ninguna URL. |

## Privacidad y ética
- La agenda comienza vacía y no exige datos personales; se guarda solo en `localStorage`.
- El texto enviado al Tutor se transmite al proveedor de IA elegido; la interfaz lo advierte.
- Las respuestas de la IA pueden contener errores: el usuario decide si acepta los bloques sugeridos.

## Normativa de referencia (Chile)
Ley N.º 21.459 (delitos informáticos), Ley N.º 19.628 sobre protección de la vida privada y Ley N.º 21.719 de protección de datos personales. Verifica su texto y vigencia vigentes antes de citarlas en tu entrega.

## Limitaciones conocidas
`localStorage` no está cifrado; la limitación de tasa es en memoria (por instancia); no hay autenticación.
