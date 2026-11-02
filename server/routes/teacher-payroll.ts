import { Router } from "express";
import { requirePermission, type AuthenticatedRequest } from "../auth.js";
import { ensureTeacherPayrollState, getTeacherPayrollSnapshot, saveTeacherPayrollSnapshot } from "../services/teacher-payroll.js";
export const teacherPayrollRouter=Router();

teacherPayrollRouter.get("/",requirePermission("payments.view"),(_req,res)=>res.json(getTeacherPayrollSnapshot()));
teacherPayrollRouter.put("/",requirePermission("payments.manage"),(req:AuthenticatedRequest,res)=>{
  res.json(saveTeacherPayrollSnapshot(req.body.state,req.body.expectedVersion,{userId:req.user!.id,ip:req.ip,reason:req.body.reason}));
});
// Normally initialized at startup. This is an explicit administrative repair entry, never a GET side effect.
teacherPayrollRouter.post("/initialize",requirePermission("payments.manage"),(_req,res)=>{
  ensureTeacherPayrollState();res.json(getTeacherPayrollSnapshot());
});
