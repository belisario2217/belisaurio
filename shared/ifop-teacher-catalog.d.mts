import type { PayrollCoreApi, PayrollState, PayrollTeacher } from './teacher-payroll-core.mjs';
declare const IFOPCatalog:{readonly id:string;readonly title:string;readonly cycle:string;readonly teachers:readonly PayrollTeacher[];createState(core:PayrollCoreApi):PayrollState;merge(state:PayrollState,core:PayrollCoreApi):{state:PayrollState;added:string[];skipped:string[]}};
export {IFOPCatalog};
export default IFOPCatalog;
