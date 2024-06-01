/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2017 Red Hat, Inc.
 *
 * Cockpit is free software; you can redistribute it and/or modify it
 * under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation; either version 2.1 of the License, or
 * (at your option) any later version.
 *
 * Cockpit is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */
import cockpit from 'cockpit';
import React from 'react';
import { Alert } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Card, CardBody, CardTitle } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { TextInput, FileUpload } from "@patternfly/react-core/dist/esm/components";

const _ = cockpit.gettext;

export class Application extends React.Component {
    constructor() {
        super();
        this.state = {
            runningContainers: [],
            stoppedContainers: [],
            unusedImages: [],
            consoleOutput: "",
            image: "",
            ports: "",
            envVars: "",
            yamlContent: ""
        };
        this.loadContainers = this.loadContainers.bind(this);
        this.loadUnusedImages = this.loadUnusedImages.bind(this);
        this.powerCycleContainer = this.powerCycleContainer.bind(this);
        this.handleDockerRun = this.handleDockerRun.bind(this);
        this.handleFileUpload = this.handleFileUpload.bind(this);
        this.handleYamlUpload = this.handleYamlUpload.bind(this);
    }

    componentDidMount() {
        this.loadContainers();
        this.loadUnusedImages();
    }

    loadContainers() {
        cockpit.spawn(["docker", "ps", "-a", "--format", "{{.ID}}"])
            .then((data) => {
                const containerIds = data.trim().split('\n');
                return Promise.all(containerIds.map(id =>
                    cockpit.spawn(["docker", "inspect", id])
                        .then((inspectData) => JSON.parse(inspectData)[0])
                ));
            })
            .then((containers) => {
                const containerData = containers.map(container => {
                    const getValueOrDefault = (value, defaultValue = 'NULL') => value == null ? defaultValue : value;

                    const data = {
                        id: getValueOrDefault(container.Id),
                        name: getValueOrDefault(container.Name.replace(/^\//, '')),
                        image: getValueOrDefault(container.Config.Image),
                        status: getValueOrDefault(container.State.Status),
                        mounts: getValueOrDefault(container.Mounts.map(mount => `${mount.Source}:${mount.Destination}`).join(', ')),
                        ports: getValueOrDefault(container.NetworkSettings.Ports ?
                            Object.entries(container.NetworkSettings.Ports)
                                .map(([port, mappings]) => mappings ? mappings.map(mapping => `${mapping.HostIp}:${mapping.HostPort}->${port}`).join(', ') : port)
                                .join(', ') : 'N/A'),
                        state: getValueOrDefault(container.State.Status),
                        health: getValueOrDefault(container.State.Health ? container.State.Health.Status : 'N/A'),
                        host: getValueOrDefault(container.Config.Hostname),
                        gpu: getValueOrDefault(container.HostConfig.DeviceRequests ?
                            container.HostConfig.DeviceRequests.map(req => req.Capabilities).flat().join(', ') : 'N/A')
                    };

                    console.log(data); // Log container data
                    return data;
                });

                const runningContainers = containerData.filter(container => container.status === "running");
                const stoppedContainers = containerData.filter(container => container.status !== "running");

                this.setState({ runningContainers, stoppedContainers });
            })
            .catch((error) => {
                console.error("Failed to fetch Docker containers:", error);
            });
    }

    loadUnusedImages() {
        cockpit.spawn(["docker", "images", "-f", "dangling=true", "--format", "{{.ID}}"])
            .then((data) => {
                const imageIds = data.trim().split('\n');
                return Promise.all(imageIds.map(id =>
                    cockpit.spawn(["docker", "inspect", id])
                        .then((inspectData) => JSON.parse(inspectData)[0])
                ));
            })
            .then((images) => {
                const imageData = images.map(image => ({
                    id: image.Id,
                    repoTags: image.RepoTags ? image.RepoTags.join(', ') : 'N/A',
                    size: image.Size
                }));
                this.setState({ unusedImages: imageData });
            })
            .catch((error) => {
                console.error("Failed to fetch unused Docker images:", error);
            });
    }

    powerCycleContainer(id) {
        cockpit.spawn(["docker", "restart", id])
            .then(() => {
                console.log(`Container ${id} restarted successfully.`);
                this.loadContainers(); // Reload the container list
            })
            .catch((error) => {
                console.error(`Failed to restart container ${id}:`, error);
            });
    }

    handleDockerRun() {
        const { image, ports, envVars } = this.state;
        const portArgs = ports ? `-p ${ports}` : '';
        const envArgs = envVars ? `-e ${envVars.split(',').join(' -e ')}` : '';
        const command = `docker run -d ${portArgs} ${envArgs} ${image}`;

        cockpit.spawn(command.split(' '))
            .then(output => {
                this.setState((prevState) => ({
                    consoleOutput: prevState.consoleOutput + "\n" + output
                }));
                this.loadContainers();
            })
            .catch((error) => {
                this.setState((prevState) => ({
                    consoleOutput: prevState.consoleOutput + "\n" + `Error: ${error}`
                }));
            });
    }

    handleFileUpload(value) {
        this.setState({ yamlContent: value });
    }

    handleYamlUpload() {
        const { yamlContent } = this.state;

        cockpit.file('/tmp/docker-compose.yml')
            .replace(yamlContent)
            .then(() => cockpit.spawn(['docker-compose', '-f', '/tmp/docker-compose.yml', 'up', '-d']))
            .then(output => {
                this.setState((prevState) => ({
                    consoleOutput: prevState.consoleOutput + "\n" + output
                }));
                this.loadContainers();
            })
            .catch((error) => {
                this.setState((prevState) => ({
                    consoleOutput: prevState.consoleOutput + "\n" + `Error: ${error}`
                }));
            });
    }

    render() {
        return (
            <Card>
                <CardTitle>Docker Resources</CardTitle>
                <CardBody>
                    {this.state.unusedImages.length > 0 && (
                        <div className="table-container">
                            <h3>Unused Images</h3>
                            <table className="pf-c-table pf-m-grid-md">
                                <thead>
                                    <tr>
                                        <th>ID</th>
                                        <th>Repo Tags</th>
                                        <th>Size</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {this.state.unusedImages.map(image => (
                                        <tr key={image.id}>
                                            <td data-full-text={image.id}>{image.id}</td>
                                            <td data-full-text={image.repoTags}>{image.repoTags}</td>
                                            <td data-full-text={image.size}>{image.size}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    <div className="table-container">
                        <h3>Running Containers</h3>
                        <table className="pf-c-table pf-m-grid-md">
                            <thead>
                                <tr>
                                    <th></th>
                                    <th>ID</th>
                                    <th>Name</th>
                                    <th>Image</th>
                                    <th>Status</th>
                                    <th>Mounts</th>
                                    <th>Ports</th>
                                    <th>State</th>
                                    <th>Health</th>
                                    <th>Host</th>
                                    <th>GPU </th>
                                </tr>
                            </thead>
                            <tbody>
                                {this.state.runningContainers.map(container => (
                                    <tr key={container.id}>
                                        <td className="button-cell">
                                            <Button variant="primary" onClick={() => this.powerCycleContainer(container.id)}>Power Cycle</Button>
                                        </td>
                                        <td data-full-text={container.id}>{container.id}</td>
                                        <td data-full-text={container.name}>{container.name}</td>
                                        <td data-full-text={container.image}>{container.image}</td>
                                        <td data-full-text={container.status}>{container.status}</td>
                                        <td data-full-text={container.mounts}>{container.mounts}</td>
                                        <td data-full-text={container.ports}>{container.ports}</td>
                                        <td data-full-text={container.state}>{container.state}</td>
                                        <td data-full-text={container.health}>{container.health}</td>
                                        <td data-full-text={container.host}>{container.host}</td>
                                        <td data-full-text={container.gpu}>{container.gpu}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <div className="table-container">
                        <h3>Stopped Containers</h3>
                        <table className="pf-c-table pf-m-grid-md">
                            <thead>
                                <tr>
                                    <th></th>
                                    <th>ID</th>
                                    <th>Name</th>
                                    <th>Image</th>
                                    <th>Status</th>
                                    <th>Mounts</th>
                                    <th>Ports</th>
                                    <th>State</th>
                                    <th>Health</th>
                                    <th>Host</th>
                                    <th>GPU</th>
                                </tr>
                            </thead>
                            <tbody>
                                {this.state.stoppedContainers.map(container => (
                                    <tr key={container.id}>
                                        <td className="button-cell">
                                            <Button variant="primary" onClick={() => this.powerCycleContainer(container.id)}>Power Cycle</Button>
                                        </td>
                                        <td data-full-text={container.id}>{container.id}</td>
                                        <td data-full-text={container.name}>{container.name}</td>
                                        <td data-full-text={container.image}>{container.image}</td>
                                        <td data-full-text={container.status}>{container.status}</td>
                                        <td data-full-text={container.mounts}>{container.mounts}</td>
                                        <td data-full-text={container.ports}>{container.ports}</td>
                                        <td data-full-text={container.state}>{container.state}</td>
                                        <td data-full-text={container.health}>{container.health}</td>
                                        <td data-full-text={container.host}>{container.host}</td>
                                        <td data-full-text={container.gpu}>{container.gpu}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <div className="form-container">
                        <h3>Run Docker Command</h3>
                        <TextInput
                            id="image"
                            type="text"
                            placeholder="Image (e.g., docker.io/pihole/pihole/)"
                            value={this.state.image}
                            onChange={(value) => this.setState({ image: value })}
                        />
                        <TextInput
                            id="ports"
                            type="text"
                            placeholder="Ports (e.g., 8080:80)"
                            value={this.state.ports}
                            onChange={(value) => this.setState({ ports: value })}
                        />
                        <TextInput
                            id="envVars"
                            type="text"
                            placeholder="Environment Variables (e.g., VAR1=value1,VAR2=value2)"
                            value={this.state.envVars}
                            onChange={(value) => this.setState({ envVars: value })}
                        />
                        <Button variant="primary" onClick={this.handleDockerRun}>Start</Button>
                    </div>

                    <div className="form-container">
                        <h3>Upload Docker Compose YAML</h3>
                        <FileUpload
                            id="yaml-upload"
                            type="text"
                            placeholder="Select YAML file"
                            onChange={this.handleFileUpload}
                        />
                        <Button variant="primary" onClick={this.handleYamlUpload}>Upload</Button>
                    </div>

                    <div className="console-output">
                        <h3>Console Output</h3>
                        <pre>{this.state.consoleOutput}</pre>
                    </div>
                </CardBody>
            </Card>
        );
    }
}

