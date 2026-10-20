/*
 * This program source code file is part of KiCad, a free EDA CAD application.
 *
 * Copyright (C) 2026 The KiCad Developers, see AUTHORS.txt for contributors.
 *
 * This program is free software: you can redistribute it and/or modify it
 * under the terms of the GNU General Public License as published by the
 * Free Software Foundation, either version 3 of the License, or (at your
 * option) any later version.
 *
 * This program is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

#ifndef COMMAND_AGENT_H
#define COMMAND_AGENT_H

#include "command.h"

namespace CLI
{

/**
 * Thin passthrough from kicad-cli to the kicad-agent AI terminal.
 *
 * Keeping the AI surface in a sibling binary lets the Go toolchain stay
 * optional while still making every AI action reachable through kicad-cli.
 */
class AGENT_COMMAND : public COMMAND
{
public:
    AGENT_COMMAND();

protected:
    int doPerform( KIWAY& aKiway ) override;
};

}

#endif
