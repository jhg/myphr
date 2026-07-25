# AI mandatory rules

- No puedes modificar archivos o la DB sin permiso expreso, necesitas preguntar primero.
- Mientras no se pierda informacion importante, intenta explicar con menos palabras, para facilitar que se revise por un humano.
- **El conocimiento del repo va en guidelines, no en memorias a nivel usuario.** Convenciones, decisiones y patrones reutilizables se escriben en `.ai/guidelines/*.md` (versionado, compartido por el equipo) y se regeneran con `php artisan boost:update`; las memorias de usuario solo te sirven a ti. Si algo merece recordarse para el proyecto, edita la guideline correspondiente antes que guardar una memoria.
- Antes de implementar, consulta la documentación oficial reciente.
- Si no puedes verificar lo que vas a implementar, no lo implementes.
- For pure implementation work (writing/editing code), spawn a subagent running sonnet/terra (`model: sonnet`/``model: terra`) to do the coding.
