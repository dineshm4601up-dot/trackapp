import { z } from "zod";

import { checkbox, optionalPhone, requiredCode, requiredEmail, requiredText } from "@/lib/validation/fields";

// Agent master data only. Role and account status are deliberately absent:
// they are authentication concerns and not editable here.
const agentFields = {
  employee_code: requiredCode("Employee code"),
  full_name: requiredText("Full name", 200),
  phone: optionalPhone,
  is_active: checkbox,
};

export const createAgentSchema = z.object({ ...agentFields, email: requiredEmail });
export const updateAgentSchema = z.object(agentFields);
